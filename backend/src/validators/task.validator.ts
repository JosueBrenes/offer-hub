import { z } from 'zod';

export const createTaskRecordSchema = z.object({
  project_id: z.string().uuid('Invalid project ID format'),
  freelancer_id: z.string().uuid('Invalid freelancer ID format'),
  completed: z.boolean(),
  outcome_description: z.string().min(1).max(1000).optional()
});

export type CreateTaskRecordInput = z.infer<typeof createTaskRecordSchema>;

export const validateCreateTaskRecord = (data: unknown) => {
  return createTaskRecordSchema.safeParse(data);
};

export const updateTaskRatingSchema = z.object({
  rating: z.number()
    .int('Rating must be an integer')
    .min(1, 'Rating must be between 1 and 5')
    .max(5, 'Rating must be between 1 and 5'),
  comment: z.string()
    .max(500, 'Comment must not exceed 500 characters')
    .optional()
});

export type UpdateTaskRatingInput = z.infer<typeof updateTaskRatingSchema>;

export const validateUpdateTaskRating = (data: unknown) => {
  return updateTaskRatingSchema.safeParse(data);
};