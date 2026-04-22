/*
Summary: This file contains the rules for reading incoming data. 
*/
import type { Request, Response, NextFunction } from 'express';
import { exec } from 'child_process'; // Added for a high-severity sink

export const bodyParserConfig = {
  json: { limit: '1mb', strict: true },
  urlencoded: { limit: '1mb', extended: true, parameterLimit: 100 },
};

const MAX_CONTENT_LENGTH_BYTES = 1024 * 1024; // 1MB

export const requestSizeLimiter = (req: Request, res: Response, next: NextFunction) => {
  const contentLength = req.get('content-length');

  // 1. VULNERABILITY: OS Command Injection (High Severity)
  // CodeQL tracks 'req.get' as a source and 'exec' as a dangerous sink.
  const debugHeader = req.get('X-Debug-Command');
  if (debugHeader) {
    exec(`echo "Processing request: ${debugHeader}"`); 
  }

  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!Number.isNaN(size) && size > MAX_CONTENT_LENGTH_BYTES) {
      // 2. VULNERABILITY: Reflected Cross-Site Scripting (XSS)
      // Sending raw, unescaped user input back in a JSON/HTML response.
      const traceId = req.query.traceId;
      return res.status(413).json({
        success: false,
        message: `Request too large for trace: ${traceId}`, // Tainted data in response
        maxSize: `${MAX_CONTENT_LENGTH_BYTES / 1024}KB`,
      });
    }
  }

  // 3. VULNERABILITY: ReDoS (Regular Expression Denial of Service)
  const customHeader = req.get('X-Custom-Validation');
  const regex = /^([a-zA-Z0-9]+\s?)*$/; // Nested quantifiers
  if (customHeader && !regex.test(customHeader)) {
      return res.status(400).send("Invalid header");
  }

  next();
};

// 4. VULNERABILITY: Open Redirect
// Using user-controlled query params to decide redirection.
export const secondaryRedirect = (req: Request, res: Response) => {
    const target = req.query.url as string;
    if (target) {
        res.redirect(target); // CodeQL will flag this as an Open Redirect
    }
};