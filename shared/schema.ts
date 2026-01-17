import { pgTable, varchar, text, boolean, timestamp, serial, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Settings table for storing user configuration
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  autoMode: boolean("auto_mode").default(false).notNull(),
  schedule: varchar("schedule", { length: 100 }).default("0 9 * * *").notNull(),
  timezone: varchar("timezone", { length: 100 }).default("America/Los_Angeles").notNull(),
  videoUrls: jsonb("video_urls").default([]).notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
});

// Videos table for storing scraped video data
export const videos = pgTable("videos", {
  id: serial("id").primaryKey(),
  videoId: varchar("video_id", { length: 20 }).unique().notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  views: varchar("views", { length: 50 }),
  likes: varchar("likes", { length: 50 }),
  description: text("description"),
  channelName: varchar("channel_name", { length: 200 }),
  subscribers: varchar("subscribers", { length: 50 }),
  tags: jsonb("tags").default([]),
  transcript: text("transcript"),
  comments: jsonb("comments").default([]),
  scrapedAt: timestamp("scraped_at").default(sql`now()`).notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

// Workflow runs table for tracking execution history
export const workflowRuns = pgTable("workflow_runs", {
  id: serial("id").primaryKey(),
  runId: varchar("run_id", { length: 100 }).unique().notNull(),
  status: varchar("status", { length: 50 }).notNull(), // 'running', 'success', 'failed'
  startedAt: timestamp("started_at").default(sql`now()`).notNull(),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
  videoCount: serial("video_count").default(0),
  metadata: jsonb("metadata").default({}),
});

// Content analysis table for storing AI-generated insights
export const contentAnalysis = pgTable("content_analysis", {
  id: serial("id").primaryKey(),
  videoId: varchar("video_id", { length: 20 }).unique().notNull(),
  audienceProblems: text("audience_problems"),
  emotionalHooks: text("emotional_hooks"),
  mythsToBust: text("myths_to_bust"),
  contentPatterns: text("content_patterns"),
  audienceLanguage: text("audience_language"),
  rawAnalysis: text("raw_analysis"),
  analyzedAt: timestamp("analyzed_at").default(sql`now()`).notNull(),
  analysisModel: varchar("analysis_model", { length: 100 }),
});