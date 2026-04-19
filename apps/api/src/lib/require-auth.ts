import { ApiError } from './api-error';

interface AuthRequestLike {
  auth: {
    sessionId: string | null;
    userId: string | null;
  };
  authError: ApiError | null;
}

export function requireAuth(request: AuthRequestLike) {
  if (request.authError) {
    throw request.authError;
  }

  const { sessionId, userId } = request.auth;
  if (!userId || !sessionId) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Access token is required.');
  }

  return {
    sessionId,
    userId,
  };
}
