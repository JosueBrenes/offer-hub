/**
 * @fileoverview Task service providing task record management and blockchain integration
 * @author Offer Hub Team
 */

import { supabase } from "@/lib/supabase/supabase";
import { TaskRecord, CreateTaskRecordDTO, UpdateTaskRatingDTO, BlockchainTaskResult } from "@/types/task.types";
import { Project } from "@/types/project.types";
import { AppError, ValidationError, ConflictError, NotFoundError, AuthorizationError } from "@/utils/AppError";
import { TaskRecordService } from "@/blockchain/task-record.service";

class TaskService {
  private blockchainService: TaskRecordService;

  constructor() {
    this.blockchainService = new TaskRecordService();
  }

  /**
   * Create a task record with blockchain registration
   * @param data - Task record creation data
   * @param clientId - ID of the client creating the record
   * @returns Created task record with blockchain transaction hash
   */
  async createTaskRecord(data: CreateTaskRecordDTO, clientId: string): Promise<TaskRecord> {
    const { project_id, freelancer_id, completed, outcome_description } = data;

    // Validate project exists and get project details
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, client_id, status, title")
      .eq("id", project_id)
      .single();

    if (projectError || !project) {
      throw new NotFoundError("Project not found");
    }

    // Validate project status is 'in_progress'
    if (project.status !== 'in_progress') {
      throw new ValidationError(`Project must be in 'in_progress' status to record task outcome. Current status: ${project.status}`);
    }

    // Validate requester is the project client
    if (project.client_id !== clientId) {
      throw new AuthorizationError("Only the project client can record task outcomes");
    }

    // Validate no existing task record for this project
    const { data: existingRecord, error: existingError } = await supabase
      .from("task_records")
      .select("id")
      .eq("project_id", project_id)
      .single();

    if (existingRecord) {
      throw new ConflictError("Task record already exists for this project");
    }

    // If existingError is not "no rows found", it's a real error
    if (existingError && existingError.code !== 'PGRST116') {
      throw new AppError(`Database error checking existing records: ${existingError.message}`, 500);
    }

    let blockchainResult: BlockchainTaskResult | null = null;
    let retryCount = 0;
    const maxRetries = 3;

    // Attempt blockchain registration with retry mechanism
    while (retryCount < maxRetries) {
      try {
        blockchainResult = await this.blockchainService.recordTask({
          project_id,
          freelancer_id,
          client_id: clientId,
          completed,
          outcome_description: outcome_description || ''
        });
        break; // Success, exit retry loop
      } catch (error) {
        retryCount++;
        console.error(`Blockchain registration attempt ${retryCount} failed:`, error);
        
        if (retryCount >= maxRetries) {
          // Log the failure but continue with database record creation
          console.error(`Failed to register task on blockchain after ${maxRetries} attempts. Proceeding with database record only.`);
          break;
        }
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
      }
    }

    // Insert task record in database
    const { data: taskRecord, error: insertError } = await supabase
      .from("task_records")
      .insert([
        {
          project_id,
          freelancer_id,
          client_id: clientId,
          completed,
          outcome_description,
          on_chain_tx_hash: blockchainResult?.transactionHash,
          on_chain_task_id: blockchainResult?.taskId,
        }
      ])
      .select()
      .single();

    if (insertError) {
      throw new AppError(`Failed to create task record: ${insertError.message}`, 500);
    }

    // Update project status based on completion
    const newProjectStatus = completed ? 'completed' : 'cancelled';
    
    const { error: updateError } = await supabase
      .from("projects")
      .update({ 
        status: newProjectStatus,
        updated_at: new Date().toISOString()
      })
      .eq("id", project_id);

    if (updateError) {
      console.error(`Failed to update project status: ${updateError.message}`);
      // Don't throw error here as the task record was created successfully
    }

    return taskRecord as TaskRecord;
  }

  /**
   * Get task record by project ID
   * @param projectId - Project ID to get task record for
   * @returns Task record or null if not found
   */
  async getTaskRecordByProjectId(projectId: string): Promise<TaskRecord | null> {
    const { data: taskRecord, error } = await supabase
      .from("task_records")
      .select("*")
      .eq("project_id", projectId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // No record found
      }
      throw new AppError(`Database error: ${error.message}`, 500);
    }

    return taskRecord as TaskRecord;
  }

  /**
   * Get task records by client ID
   * @param clientId - Client ID to get task records for
   * @returns Array of task records
   */
  async getTaskRecordsByClientId(clientId: string): Promise<TaskRecord[]> {
    const { data: taskRecords, error } = await supabase
      .from("task_records")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new AppError(`Database error: ${error.message}`, 500);
    }

    return taskRecords as TaskRecord[];
  }

  /**
   * Get task records by freelancer ID
   * @param freelancerId - Freelancer ID to get task records for
   * @returns Array of task records
   */
  async getTaskRecordsByFreelancerId(freelancerId: string): Promise<TaskRecord[]> {
    const { data: taskRecords, error } = await supabase
      .from("task_records")
      .select("*")
      .eq("freelancer_id", freelancerId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new AppError(`Database error: ${error.message}`, 500);
    }

    return taskRecords as TaskRecord[];
  }

  /**
   * Update task rating for a completed task
   * @param recordId - Task record ID to update
   * @param data - Rating data (rating and optional comment)
   * @param clientId - ID of the client updating the rating
   * @returns Updated task record
   */
  async updateTaskRating(recordId: string, data: UpdateTaskRatingDTO, clientId: string): Promise<TaskRecord> {
    const { rating, comment } = data;

    // Validate task record exists
    const { data: taskRecord, error: fetchError } = await supabase
      .from("task_records")
      .select("*")
      .eq("id", recordId)
      .single();

    if (fetchError || !taskRecord) {
      if (fetchError?.code === 'PGRST116') {
        throw new NotFoundError("Task record not found");
      }
      throw new AppError(`Database error: ${fetchError?.message || 'Unknown error'}`, 500);
    }

    // Validate requester is the task client
    if (taskRecord.client_id !== clientId) {
      throw new AuthorizationError("Only the project client can rate the task");
    }

    // Validate rating not already set (prevent changes)
    if (taskRecord.rating !== null && taskRecord.rating !== undefined) {
      throw new ConflictError("Rating has already been set and cannot be changed");
    }

    // Validate task is completed (only completed tasks can be rated)
    if (!taskRecord.completed) {
      throw new ValidationError("Only completed tasks can be rated");
    }

    // Update rating and comment
    const updateData: { rating: number; rating_comment?: string | null; updated_at: string } = {
      rating,
      updated_at: new Date().toISOString()
    };

    if (comment !== undefined) {
      // Convert empty string to null to satisfy database constraint
      updateData.rating_comment = comment && comment.trim().length > 0 ? comment.trim() : null;
    }

    const { data: updatedRecord, error: updateError } = await supabase
      .from("task_records")
      .update(updateData)
      .eq("id", recordId)
      .select()
      .single();

    if (updateError) {
      throw new AppError(`Failed to update task rating: ${updateError.message}`, 500);
    }

    return updatedRecord as TaskRecord;
  }
}

export const taskService = new TaskService();