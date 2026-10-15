CREATE TABLE `deviceCode` (
	`id` text PRIMARY KEY NOT NULL,
	`deviceCode` text NOT NULL,
	`userCode` text NOT NULL,
	`userId` text,
	`clientId` text NOT NULL,
	`scope` text,
	`status` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`lastPolledAt` integer,
	`pollingInterval` integer,
	`createdAt` integer,
	`updatedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deviceCode_deviceCode_unique` ON `deviceCode` (`deviceCode`);--> statement-breakpoint
CREATE UNIQUE INDEX `deviceCode_userCode_unique` ON `deviceCode` (`userCode`);--> statement-breakpoint
ALTER TABLE `user` ADD `role` text DEFAULT 'user' NOT NULL;