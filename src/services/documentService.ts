import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { config } from '../config/environment';
import { logger } from '@team-deepiri/shared-utils';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as mime from 'mime-types';
import axios from 'axios';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

// A presigned URL generated right before use, good only long enough for
// that one immediate operation (e.g. handing it to Cyrex for extraction).
// Never persist this — see getPresignedDownloadUrl for on-demand links.
const SHORT_LIVED_URL_TTL_SECONDS = 600; // 10 minutes
const DEFAULT_DOWNLOAD_URL_TTL_SECONDS = 900; // 15 minutes

export interface UploadResult {
  /** Stable reference — safe to persist. Not a fetchable URL by itself;
   *  get a working link via getPresignedDownloadUrl(storageKey). */
  storageKey: string;
  fileSize: number;
  mimeType: string;
}

/**
 * Map MIME type / filename to the file-format labels stored on IntelligenceDocument.documentType.
 * Distinct from business documentKind (lease, policy, etc.).
 */
export function resolveFileDocumentType(
  mimeType?: string | null,
  fileNameOrKey?: string | null
): string {
  const mime = (mimeType || '').toLowerCase();
  const name = (fileNameOrKey || '').toLowerCase().split('?')[0];

  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'PDF';
  if (
    mime.includes('wordprocessingml') ||
    mime.includes('msword') ||
    mime.includes('officedocument.word') ||
    name.endsWith('.docx') ||
    name.endsWith('.doc')
  ) {
    return 'DOCX';
  }
  if (mime.startsWith('text/plain') || name.endsWith('.txt')) return 'TXT';
  if (mime.includes('markdown') || name.endsWith('.md') || name.endsWith('.markdown')) return 'MD';
  if (mime.includes('csv') || name.endsWith('.csv')) return 'CSV';
  if (mime.includes('json') || name.endsWith('.json')) return 'JSON';
  if (
    mime.startsWith('image/') ||
    /\.(jpe?g|png|gif|bmp|webp|tiff?)$/.test(name)
  ) {
    return 'IMAGE';
  }
  if (mime.startsWith('text/')) return 'TXT';

  return 'UNKNOWN';
}

export class DocumentService {
  private s3Client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = config.storage.bucket;

    if (config.storage.provider === 's3' && !config.storage.endpoint) {
      // Real AWS S3: no custom endpoint, virtual-hosted-style addressing.
      this.s3Client = new S3Client({
        region: config.storage.region,
        credentials: {
          accessKeyId: config.storage.accessKeyId,
          secretAccessKey: config.storage.secretAccessKey,
        },
      });
    } else {
      // Any S3-compatible provider (MinIO, Cloudflare R2, Backblaze B2, DO
      // Spaces, Wasabi, ...) — driven by STORAGE_ENDPOINT rather than a
      // hardcoded provider allowlist, so this doesn't crash on boot just
      // because STORAGE_PROVIDER isn't literally 's3' or 'minio'.
      if (!config.storage.endpoint) {
        throw new Error(
          `STORAGE_ENDPOINT is required when STORAGE_PROVIDER ("${config.storage.provider}") isn't plain 's3'`
        );
      }
      this.s3Client = new S3Client({
        endpoint: config.storage.endpoint,
        region: config.storage.region,
        credentials: {
          accessKeyId: config.storage.accessKeyId,
          secretAccessKey: config.storage.secretAccessKey,
        },
        forcePathStyle: true,
      });
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

      logger.info('Document uploaded', {
        storageKey,
        fileSize: file.size,
        mimeType,
      });

      return {
        storageKey,
        fileSize: file.size,
        mimeType,
      };
    } catch (error: any) {
      logger.error('Failed to upload document', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate a fresh, time-limited link to an object — call this on demand
   * (e.g. from a "download" endpoint) rather than persisting the result.
   * Objects are private by default (no ACL is set on upload), so this is
   * the only supported way to get a working link to one.
   */
  async getPresignedDownloadUrl(
    storageKey: string,
    expiresInSeconds: number = DEFAULT_DOWNLOAD_URL_TTL_SECONDS
  ): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: storageKey });
    return getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Download a file from storage into a Buffer, straight off the storage
   * key via the authenticated SDK client — no URL round-tripping needed,
   * since this never leaves our own process.
   */
  private async downloadBuffer(storageKey: string): Promise<Buffer> {
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
  private async extractTextLocal(storageKey: string): Promise<string | null> {
    const keyLower = storageKey.toLowerCase();

    const isPdf = keyLower.endsWith('.pdf');
    const isDocx = keyLower.endsWith('.docx') || keyLower.endsWith('.doc');
    const isPlain =
      keyLower.endsWith('.txt') ||
      keyLower.endsWith('.md') ||
      keyLower.endsWith('.csv') ||
      keyLower.endsWith('.json');

    if (!isPdf && !isDocx && !isPlain) return null;

    const buffer = await this.downloadBuffer(storageKey);

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
   * Extract text from a document already in our storage.
   * Tries local extraction first (pdf-parse / mammoth / plain-text read) —
   * works offline, no Cyrex round-trip for common types. Falls back to
   * Cyrex for image/OCR types or when local extraction fails; Cyrex fetches
   * the document itself over HTTP, so this presigns a fresh short-lived URL
   * right before that call rather than trusting a URL passed in or stored
   * earlier (which may be long expired if this is a reprocessing run).
   */
  async extractText(storageKey: string, documentType?: string): Promise<string> {
    logger.info('Extracting text from document', { storageKey, documentType });

    // Try local extraction — works offline, no Cyrex needed for common types
    try {
      const localText = await this.extractTextLocal(storageKey);
      if (localText !== null) {
        logger.info('Text extracted locally', { storageKey, length: localText.length });
        return localText;
      }
    } catch (localError: any) {
      logger.warn('Local text extraction failed, falling back to Cyrex', {
        storageKey,
        error: localError.message,
      });
    }

    // Cyrex fallback (OCR / complex types)
    try {
      const fileFormat = resolveFileDocumentType(undefined, storageKey);
      const resolvedType =
        documentType ||
        (fileFormat === 'IMAGE'
          ? 'image'
          : fileFormat === 'UNKNOWN'
            ? 'pdf'
            : fileFormat.toLowerCase());

      const documentUrl = await this.getPresignedDownloadUrl(storageKey, SHORT_LIVED_URL_TTL_SECONDS);

      const response = await axios.post(
        `${config.cyrex.baseUrl}/document-extraction/extract-text`,
        { documentUrl, documentType: resolvedType },
        {
          headers: { 'Content-Type': 'application/json', 'x-api-key': config.cyrex.apiKey },
          timeout: 120000,
        }
      );

      if (!response.data.success) throw new Error(response.data.error || 'Cyrex extraction failed');

      const extractedText = response.data.text || '';
      if (!extractedText.trim()) {
        throw new Error('Cyrex extraction returned empty text');
      }

      return extractedText;
    } catch (cyrexError: any) {
      logger.error('Cyrex text extraction failed', {
        storageKey,
        error: cyrexError.message,
      });
      throw cyrexError;
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
      throw error;
    }
  }
}

export const documentService = new DocumentService();
