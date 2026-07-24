import { z } from 'zod';

export const ApiErrorCodeSchema = z.enum([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'validation_error',
  'delivery_failed',
  'internal_error',
]);

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorBodySchema = z.object({
  code: ApiErrorCodeSchema,
  message: z.string().min(1),
  details: z.record(z.unknown()).optional(),
});

export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

/** Standard JSON error envelope for HTTP API responses. */
export const ApiErrorResponseSchema = z.object({
  error: ApiErrorBodySchema,
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

/** Offset/limit pagination meta (sibling to resource arrays under `data`). */
export const PaginationMetaSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/** Build a success-response schema wrapping arbitrary payload data. */
export function apiSuccessResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema,
  });
}

/**
 * Build a paginated list response schema.
 * Resource arrays stay under a named key (e.g. `runs`); meta fields sit alongside.
 */
export function paginatedListDataSchema<T extends z.ZodTypeAny>(
  resourceKey: string,
  itemSchema: T,
) {
  return z
    .object({
      total: z.number().int().nonnegative(),
      limit: z.number().int().positive(),
      offset: z.number().int().nonnegative(),
    })
    .catchall(z.unknown())
    .and(z.object({ [resourceKey]: z.array(itemSchema) }));
}

/** List payload with `items` plus pagination meta. */
export function paginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.object({
      items: z.array(itemSchema),
      total: z.number().int().nonnegative(),
      limit: z.number().int().positive(),
      offset: z.number().int().nonnegative(),
    }),
  });
}

/** Parse and validate an API error response payload. */
export function parseApiErrorResponse(input: unknown): ApiErrorResponse {
  return ApiErrorResponseSchema.parse(input);
}

/** Safe-parse variant returning a Zod result. */
export function safeParseApiErrorResponse(input: unknown) {
  return ApiErrorResponseSchema.safeParse(input);
}
