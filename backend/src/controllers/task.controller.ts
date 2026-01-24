/**
 * @fileoverview Task controller handling task record operations
 * @author Offer Hub Team
 */

import { NextFunction, Request, Response } from "express";
import { taskService } from "@/services/task.service";
import { CreateTaskRecordDTO, UpdateTaskRatingDTO } from "@/types/task.types";
import { AuthenticatedRequest } from "@/types/auth.types";
import { validateCreateTaskRecord, validateUpdateTaskRating } from "@/validators/task.validator";
import { AppError, ValidationError } from "@/utils/AppError";

/**
 * Record task outcome with blockchain registration
 * @route POST /api/task-records
 * @param req - Express request object with authenticated user
 * @param res - Express response object
 * @param next - Express next function
 *
 * Expected request body:
 * {
 *   "project_id": "string (required) - UUID of the project",
 *   "freelancer_id": "string (required) - UUID of the freelancer",
 *   "completed": "boolean (required) - Whether task was completed successfully",
 *   "outcome_description": "string (optional) - Description of the outcome"
 * }
 *
 * Response format:
 * {
 *   "success": true,
 *   "message": "Task outcome recorded successfully",
 *   "data": {
 *     "taskRecord": {
 *       "id": "string",
 *       "project_id": "string",
 *       "freelancer_id": "string",
 *       "client_id": "string",
 *       "completed": boolean,
 *       "outcome_description": "string",
 *       "on_chain_tx_hash": "string",
 *       "on_chain_task_id": number,
 *       "created_at": "string",
 *       "updated_at": "string"
 *     }
 *   },
 *   "metadata": {
 *     "timestamp": "string",
 *     "requestId": "string"
 *   }
 * }
 */
export async function recordTaskOutcome(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authReq = req as AuthenticatedRequest;
    
    // Ensure user is authenticated
    if (!authReq.user) {
      return next(new AppError("Authentication required", 401));
    }

    const clientId = authReq.user.id;
    const requestData = req.body as CreateTaskRecordDTO;

    // Validate request body
    const validationResult = validateCreateTaskRecord(requestData);
    
    if (!validationResult.success) {
      const errorMessages = validationResult.error.issues.map((err: any) => 
        `${err.path.join('.')}: ${err.message}`
      ).join(', ');
      
      return next(new ValidationError(`Validation failed: ${errorMessages}`));
    }

    // Create task record
    const taskRecord = await taskService.createTaskRecord(validationResult.data, clientId);

    // Build success response
    res.status(201).json({
      success: true,
      message: "Task outcome recorded successfully",
      data: {
        taskRecord
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: authReq.securityContext?.requestId || 'unknown',
      }
    });

  } catch (error) {
    next(error);
  }
}

/**
 * Get task record by project ID
 * @route GET /api/task-records/project/:projectId
 * @param req - Express request object with authenticated user
 * @param res - Express response object
 * @param next - Express next function
 */
export async function getTaskRecordByProject(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authReq = req as AuthenticatedRequest;
    
    if (!authReq.user) {
      return next(new AppError("Authentication required", 401));
    }

    const { projectId } = req.params;

    if (!projectId) {
      return next(new ValidationError("Project ID is required"));
    }

    const taskRecord = await taskService.getTaskRecordByProjectId(projectId);

    if (!taskRecord) {
      return res.status(404).json({
        success: false,
        message: "Task record not found for this project",
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: authReq.securityContext?.requestId || 'unknown',
        }
      });
    }

    res.status(200).json({
      success: true,
      message: "Task record retrieved successfully",
      data: {
        taskRecord
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: authReq.securityContext?.requestId || 'unknown',
      }
    });

  } catch (error) {
    next(error);
  }
}

/**
 * Get task records by client ID (current user)
 * @route GET /api/task-records/client
 * @param req - Express request object with authenticated user
 * @param res - Express response object
 * @param next - Express next function
 */
export async function getClientTaskRecords(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authReq = req as AuthenticatedRequest;
    
    if (!authReq.user) {
      return next(new AppError("Authentication required", 401));
    }

    const clientId = authReq.user.id;
    const taskRecords = await taskService.getTaskRecordsByClientId(clientId);

    res.status(200).json({
      success: true,
      message: "Client task records retrieved successfully",
      data: {
        taskRecords,
        count: taskRecords.length
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: authReq.securityContext?.requestId || 'unknown',
      }
    });

  } catch (error) {
    next(error);
  }
}

/**
 * Get task records by freelancer ID (current user)
 * @route GET /api/task-records/freelancer
 * @param req - Express request object with authenticated user
 * @param res - Express response object
 * @param next - Express next function
 */
export async function getFreelancerTaskRecords(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authReq = req as AuthenticatedRequest;
    
    if (!authReq.user) {
      return next(new AppError("Authentication required", 401));
    }

    const freelancerId = authReq.user.id;
    const taskRecords = await taskService.getTaskRecordsByFreelancerId(freelancerId);

    res.status(200).json({
      success: true,
      message: "Freelancer task records retrieved successfully",
      data: {
        taskRecords,
        count: taskRecords.length
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: authReq.securityContext?.requestId || 'unknown',
      }
    });

  } catch (error) {
    next(error);
  }
}

/**
 * Update task rating for a completed task
 * @route PATCH /api/task-records/:recordId/rating
 * @param req - Express request object with authenticated user
 * @param res - Express response object
 * @param next - Express next function
 *
 * Expected request body:
 * {
 *   "rating": "number (required) - Integer between 1 and 5",
 *   "comment": "string (optional) - Comment max 500 characters"
 * }
 *
 * Response format:
 * {
 *   "success": true,
 *   "message": "Task rating updated successfully",
 *   "data": {
 *     "taskRecord": {
 *       "id": "string",
 *       "project_id": "string",
 *       "freelancer_id": "string",
 *       "client_id": "string",
 *       "completed": boolean,
 *       "rating": number,
 *       "rating_comment": "string",
 *       "created_at": "string",
 *       "updated_at": "string"
 *     }
 *   },
 *   "metadata": {
 *     "timestamp": "string",
 *     "requestId": "string"
 *   }
 * }
 */
export async function updateTaskRatingHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authReq = req as AuthenticatedRequest;
    
    // Ensure user is authenticated
    if (!authReq.user) {
      return next(new AppError("Authentication required", 401));
    }

    const { recordId } = req.params;
    const clientId = authReq.user.id;
    const requestData = req.body as UpdateTaskRatingDTO;

    // Validate recordId is provided
    if (!recordId) {
      return next(new ValidationError("Task record ID is required"));
    }

    // Validate request body
    const validationResult = validateUpdateTaskRating(requestData);
    
    if (!validationResult.success) {
      const errorMessages = validationResult.error.issues.map((err: any) => 
        `${err.path.join('.')}: ${err.message}`
      ).join(', ');
      
      return next(new ValidationError(`Validation failed: ${errorMessages}`));
    }

    // Update task rating
    const taskRecord = await taskService.updateTaskRating(recordId, validationResult.data, clientId);

    // Build success response
    res.status(200).json({
      success: true,
      message: "Task rating updated successfully",
      data: {
        taskRecord
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: authReq.securityContext?.requestId || 'unknown',
      }
    });

  } catch (error) {
    next(error);
  }
}