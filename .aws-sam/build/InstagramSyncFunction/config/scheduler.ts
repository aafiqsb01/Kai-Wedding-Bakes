import {
    EventBridgeClient,
    PutRuleCommand,
    PutTargetsCommand,
    DescribeRuleCommand,
    DeleteRuleCommand,
    RemoveTargetsCommand,
  } from "@aws-sdk/client-eventbridge";
  
  // Initialize EventBridge client
  const eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION || "eu-west-2" });
  
  const RULE_NAME = process.env.AWS_EVENTBRIDGE_RULE_NAME || "opulence-instagram-sync-daily";
  const LAMBDA_ARN = process.env.AWS_LAMBDA_INSTAGRAM_SYNC_ARN || ""; // Will be set after Lambda is deployed
  
  // ============================================
  // EventBridge Scheduler Operations
  // ============================================
  
  /**
   * Create or update a scheduled rule for Instagram sync
   * Runs daily at 2 AM UTC (can be adjusted)
   * @param lambdaArn - ARN of the Instagram sync Lambda function
   */
  export async function createInstagramSyncSchedule(lambdaArn: string): Promise<void> {
    // Create the EventBridge rule
    const ruleCommand = new PutRuleCommand({
      Name: RULE_NAME,
      ScheduleExpression: "cron(0 2 * * ? *)", // Daily at 2 AM UTC
      State: "ENABLED",
      Description: "Daily Instagram photo sync for Opulence Wedding Bakes",
    });
  
    await eventBridgeClient.send(ruleCommand);
    console.log(`✅ EventBridge rule created: ${RULE_NAME}`);
  
    // Add Lambda as target
    const targetCommand = new PutTargetsCommand({
      Rule: RULE_NAME,
      Targets: [
        {
          Arn: lambdaArn,
          Id: "InstagramSyncLambda",
          RoleArn: process.env.AWS_EVENTBRIDGE_ROLE_ARN || "", // IAM role that allows EventBridge to invoke Lambda
        },
      ],
    });
  
    await eventBridgeClient.send(targetCommand);
    console.log(`✅ Lambda attached as target to rule: ${RULE_NAME}`);
  }
  
  /**
   * Check if the Instagram sync schedule exists
   */
  export async function scheduleExists(): Promise<boolean> {
    try {
      const command = new DescribeRuleCommand({
        Name: RULE_NAME,
      });
      await eventBridgeClient.send(command);
      return true;
    } catch (error: any) {
      if (error.name === "ResourceNotFoundException") {
        return false;
      }
      throw error;
    }
  }
  
  /**
   * Disable the scheduled rule (stops Instagram syncs)
   */
  export async function disableSchedule(): Promise<void> {
    const command = new PutRuleCommand({
      Name: RULE_NAME,
      ScheduleExpression: "cron(0 2 * * ? *)",
      State: "DISABLED",
    });
  
    await eventBridgeClient.send(command);
    console.log(`⏸️  Schedule disabled: ${RULE_NAME}`);
  }
  
  /**
   * Enable the scheduled rule (resumes Instagram syncs)
   */
  export async function enableSchedule(): Promise<void> {
    const command = new PutRuleCommand({
      Name: RULE_NAME,
      ScheduleExpression: "cron(0 2 * * ? *)",
      State: "ENABLED",
    });
  
    await eventBridgeClient.send(command);
    console.log(`▶️  Schedule enabled: ${RULE_NAME}`);
  }
  
  /**
   * Delete the scheduled rule (WARNING: removes daily syncs)
   */
  export async function deleteSchedule(): Promise<void> {
    // Remove targets first
    const removeTargetsCommand = new RemoveTargetsCommand({
      Rule: RULE_NAME,
      Ids: ["InstagramSyncLambda"],
    });
  
    await eventBridgeClient.send(removeTargetsCommand);
    console.log(`Targets removed from rule: ${RULE_NAME}`);
  
    // Delete the rule
    const deleteRuleCommand = new DeleteRuleCommand({
      Name: RULE_NAME,
    });
  
    await eventBridgeClient.send(deleteRuleCommand);
    console.log(`🗑️  Schedule deleted: ${RULE_NAME}`);
  }
  
  /**
   * Update the schedule frequency
   * @param cronExpression - Cron expression (e.g., "cron(0 2 * * ? *)" for 2 AM UTC daily)
   * @see https://docs.aws.amazon.com/eventbridge/latest/userguide/scheduled-events.html
   */
  export async function updateScheduleFrequency(cronExpression: string): Promise<void> {
    const command = new PutRuleCommand({
      Name: RULE_NAME,
      ScheduleExpression: cronExpression,
      State: "ENABLED",
    });
  
    await eventBridgeClient.send(command);
    console.log(`⏰ Schedule updated to: ${cronExpression}`);
  }