import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { config } from '../config/environment';
import { logger } from '@deepiri/shared-utils';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as mime from 'mime-types';
import axios from 'axios';

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
   * Extract text from document
   * Calls Cyrex for text extraction (OCR/PDF parsing)
   */
  async extractText(documentUrl: string, documentType?: string): Promise<string> {
    try {
      logger.info('Extracting text from document', { documentUrl, documentType });
      
      // Determine document type from URL if not provided
      if (!documentType) {
        const urlLower = documentUrl.toLowerCase();
        if (urlLower.endsWith('.pdf')) {
          documentType = 'pdf';
        } else if (urlLower.endsWith('.docx') || urlLower.endsWith('.doc')) {
          documentType = 'docx';
        } else if (urlLower.match(/\.(jpg|jpeg|png|gif|bmp)$/)) {
          documentType = 'image';
        } else {
          documentType = 'pdf'; // Default
        }
      }
      
      // Call Cyrex document extraction API
      const response = await axios.post(
        `${config.cyrex.baseUrl}/document-extraction/extract-text`,
        { 
          documentUrl,
          documentType: documentType || 'pdf'
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.cyrex.apiKey,
          },
          timeout: 120000, // 2 minutes for large documents
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.error || 'Text extraction failed');
      }

      return response.data.text || '';
    } catch (error: any) {
      logger.error('Failed to extract text', {
        documentUrl,
        documentType,
        error: error.message,
      });
      throw new Error(`Text extraction failed: ${error.message}`);
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

