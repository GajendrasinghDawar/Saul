CREATE TABLE `secrets` (
	`name` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`kind` text NOT NULL,
	`allowedHosts` text,
	`updatedAt` integer NOT NULL,
	`updatedBy` text
);
--> statement-breakpoint
ALTER TABLE `user_conversations` ADD `title` text;