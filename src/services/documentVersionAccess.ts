export interface DocumentVersionActor {
  userId?: string;
  organizationId?: string;
}

export interface VersionedDocumentOwner {
  userId?: string | null;
  organizationId?: string | null;
}

export class DocumentVersionAccessError extends Error {
  constructor(
    message: string,
    readonly statusCode: 401 | 403
  ) {
    super(message);
    this.name = 'DocumentVersionAccessError';
  }
}

export function assertDocumentVersionAccess(
  actor: DocumentVersionActor | undefined,
  owner: VersionedDocumentOwner
): void {
  if (!actor?.userId) {
    throw new DocumentVersionAccessError('User authentication is required.', 401);
  }

  if (owner.userId && owner.userId !== actor.userId) {
    throw new DocumentVersionAccessError('Not authorized to modify this document.', 403);
  }

  if (owner.organizationId && owner.organizationId !== actor.organizationId) {
    throw new DocumentVersionAccessError('Not authorized to modify this document.', 403);
  }
}
