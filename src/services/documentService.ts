import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { config } from '../config/environment';
import { logger } from '@deepiri/shared-utils';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as mime from 'mime-types';
import axios from 'axios';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export interface UploadResult {
  url: string;
  storageKey: string;
  fileSize: number;
  mimeType: string;
}

export class DocumentService {
  private s3Client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = config.storage.bucket;
    
    if (config.storage.provider === 's3') {
      this.s3Client = new S3Client({
        region: config.storage.region,
        credentials: {
          accessKeyId: config.storage.accessKeyId,
          secretAccessKey: config.storage.secretAccessKey,
        },
      });
    } else if (config.storage.provider === 'minio') {
      this.s3Client = new S3Client({
        endpoint: config.storage.endpoint,
        region: config.storage.region,
        credentials: {
          accessKeyId: config.storage.accessKeyId,
          secretAccessKey: config.storage.secretAccessKey,
        },
        forcePathStyle: true,
      });
    } else {
      throw new Error(`Unsupported storage provider: ${config.storage.provider}`);
    }
  }

  /**
   * Upload document to object storage
   */
  async uploadDocument(
    file: Express.Multer.File,
    folder: string = 'documents'
  ): Promise<UploadResult> {
    try {
      const fileExtension = path.extname(file.originalname);
      const fileName = `${uuidv4()}${fileExtension}`;
      const storageKey = `${folder}/${fileName}`;
      const mimeType = file.mimetype || mime.lookup(file.originalname) || 'application/octet-stream';

      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.bucket,
          Key: storageKey,
          Body: file.buffer,
          ContentType: mimeType,
          Metadata: {
            originalName: file.originalname,
            uploadedAt: new Date().toISOString(),
          },
        },
      });

      await upload.done();

      const url = config.storage.provider === 's3'
        ? `https://${this.bucket}.s3.${config.storage.region}.amazonaws.com/${storageKey}`
        : `${config.storage.endpoint}/${this.bucket}/${storageKey}`;

      logger.info('Document uploaded', {
        storageKey,
        fileSize: file.size,
        mimeType,
      });

      return {
        url,
        storageKey,
        fileSize: file.size,
        mimeType,
      };
    } catch (error: any) {
      logger.error('Failed to upload document', { error: error.message });
      throw new Error(`Document upload failed: ${error.message}`);
    }
  }

  /**
   * Download a file from storage into a Buffer using the S3 client.
   * Derives the storage key from the documentUrl.
   */
  private async downloadBuffer(documentUrl: string): Promise<Buffer> {
    // Derive storage key: strip endpoint + bucket prefix from the full URL
    const prefix = `${config.storage.endpoint}/${config.storage.bucket}/`;
    const storageKey = documentUrl.startsWith(prefix)
      ? documentUrl.slice(prefix.length)
      : documentUrl.replace(/^https?:\/\/[^/]+\/[^/]+\//, '');

    const command = new GetObjectCommand({ Bucket: this.bucket, Key: storageKey });
    const response = await this.s3Client.send(command);
    if (!response.Body) throw new Error('Empty response from storage');

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Extract text locally using pdf-parse (PDF), mammoth (DOCX), or direct read (plain text).
   * Returns null when the file type is not handled locally (e.g. images).
   */
  private async extractTextLocal(documentUrl: string): Promise<string | null> {
    const urlLower = documentUrl.toLowerCase().split('?')[0];

    const isPdf = urlLower.endsWith('.pdf');
    const isDocx = urlLower.endsWith('.docx') || urlLower.endsWith('.doc');
    const isPlain =
      urlLower.endsWith('.txt') ||
      urlLower.endsWith('.md') ||
      urlLower.endsWith('.csv') ||
      urlLower.endsWith('.json');

    if (!isPdf && !isDocx && !isPlain) return null;

    const buffer = await this.downloadBuffer(documentUrl);

    if (isPlain) {
      return buffer.toString('utf-8');
    }

    if (isPdf) {
      const result = await pdfParse(buffer);
      return result.text || '';
    }

    if (isDocx) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    }

    return null;
  }

  /**
   * Extract text from a document.
   * Tries local extraction first (pdf-parse / mammoth / plain-text read).
   * Falls back to Cyrex for image/OCR types or when local extraction fails.
   * If Cyrex is also unavailable, returns an empty string so processing can continue.
   */
  async extractText(documentUrl: string, documentType?: string): Promise<string> {
    logger.info('Extracting text from document', { documentUrl, documentType });

    // Try local extraction — works offline, no Cyrex needed for common types
    try {
      const localText = await this.extractTextLocal(documentUrl);
      if (localText !== null) {
        logger.info('Text extracted locally', { documentUrl, length: localText.length });
        return localText;
      }
    } catch (localError: any) {
      logger.warn('Local text extraction failed, falling back to Cyrex', {
        documentUrl,
        error: localError.message,
      });
    }

    // Cyrex fallback (OCR / complex types)
    try {
      const urlLower = documentUrl.toLowerCase();
      const resolvedType =
        documentType ||
        (urlLower.endsWith('.pdf') ? 'pdf' :
         urlLower.endsWith('.docx') || urlLower.endsWith('.doc') ? 'docx' :
         urlLower.match(/\.(jpg|jpeg|png|gif|bmp)$/) ? 'image' : 'pdf');

      const response = await axios.post(
        `${config.cyrex.baseUrl}/document-extraction/extract-text`,
        { documentUrl, documentType: resolvedType },
        {
          headers: { 'Content-Type': 'application/json', 'x-api-key': config.cyrex.apiKey },
          timeout: 120000,
        }
      );

      if (!response.data.success) throw new Error(response.data.error || 'Cyrex extraction failed');
      return response.data.text || '';
    } catch (cyrexError: any) {
      logger.warn('Cyrex text extraction unavailable, continuing with empty text', {
        documentUrl,
        error: cyrexError.message,
      });
      return '';
    }
  }

  /**
   * Delete document from storage
   */
  async deleteDocument(storageKey: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
      });

      await this.s3Client.send(command);
      logger.info('Document deleted', { storageKey });
    } catch (error: any) {
      logger.error('Failed to delete document', {
        storageKey,
        error: error.message,
      });
      throw new Error(`Document deletion failed: ${error.message}`);
    }
  }
}

export const documentService = new DocumentService();

