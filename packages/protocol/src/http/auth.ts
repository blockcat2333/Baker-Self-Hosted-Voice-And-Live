import { z } from 'zod';

export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  username: z.string().min(2).max(32),
});

export const AdminCreateUserRequestSchema = RegisterRequestSchema;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1),
});

export const LogoutResponseSchema = z.object({
  ok: z.literal(true),
});

export const UpdateMeRequestSchema = z.object({
  username: z.string().min(2).max(32),
});

export const AuthTokensSchema = z.object({
  accessToken: z.string().min(1),
  expiresInSeconds: z.number().int().positive(),
  refreshToken: z.string().min(1),
});

export const AuthUserSchema = z.object({
  email: z.string().email(),
  id: z.string().uuid(),
  username: z.string(),
});

export const AuthSessionSchema = z.object({
  tokens: AuthTokensSchema,
  user: AuthUserSchema,
});

export const MeResponseSchema = AuthUserSchema;

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type AdminCreateUserRequest = z.infer<typeof AdminCreateUserRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
