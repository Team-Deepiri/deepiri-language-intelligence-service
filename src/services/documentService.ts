import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { config } from '../config/environment';
import { logger } from '@team-deepiri/shared-utils';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as mime from 'mime-types';
import axios from 'axios';

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
   * Extract text from a document already in our storage.
   * Calls Cyrex for text extraction (OCR/PDF parsing) — Cyrex fetches the
   * document itself over HTTP, so this presigns a fresh short-lived URL
   * right before the call rather than trusting a URL passed in or stored
   * earlier (which may be long expired if this is a reprocessing run).
   */
  async extractText(storageKey: string, documentType?: string): Promise<string> {
    try {
      logger.info('Extracting text from document', { storageKey, documentType });

      // Determine document type from the storage key if not provided
      if (!documentType) {
        const keyLower = storageKey.toLowerCase();
        if (keyLower.endsWith('.pdf')) {
          documentType = 'pdf';
        } else if (keyLower.endsWith('.docx') || keyLower.endsWith('.doc')) {
          documentType = 'docx';
        } else if (keyLower.match(/\.(jpg|jpeg|png|gif|bmp)$/)) {
          documentType = 'image';
        } else {
          documentType = 'pdf'; // Default
        }
      }

      const documentUrl = await this.getPresignedDownloadUrl(storageKey, SHORT_LIVED_URL_TTL_SECONDS);

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
        storageKey,
        documentType,
        error: error.message,
      });
      throw error;
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

