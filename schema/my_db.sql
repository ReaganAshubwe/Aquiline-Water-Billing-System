CREATE DATABASE IF NOT EXISTS `my_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `my_db`;

CREATE TABLE IF NOT EXISTS `awbc_customers` (
  `id` CHAR(36) NOT NULL,
  `full_name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(32) NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `last_activity_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_awbc_customers_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `awbc_payments` (
  `id` CHAR(36) NOT NULL,
  `customer_id` CHAR(36) NOT NULL,
  `phone` VARCHAR(32) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `unit_type` VARCHAR(20) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `payment_channel` VARCHAR(50) NOT NULL DEFAULT 'mpesa_stk',
  `checkout_request_id` VARCHAR(100) DEFAULT NULL,
  `merchant_request_id` VARCHAR(100) DEFAULT NULL,
  `mpesa_receipt` VARCHAR(100) DEFAULT NULL,
  `mpesa_receipt_submitted` VARCHAR(100) DEFAULT NULL,
  `token_code` VARCHAR(32) DEFAULT NULL,
  `litres_bought` INT NOT NULL DEFAULT 0,
  `refunded_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `refund_status` VARCHAR(20) NOT NULL DEFAULT 'none',
  `failure_reason` TEXT DEFAULT NULL,
  `rejection_reason` TEXT DEFAULT NULL,
  `settlement_id` CHAR(36) DEFAULT NULL,
  `sms` LONGTEXT DEFAULT NULL,
  `approved_at` DATETIME(3) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_awbc_payments_customer_id` (`customer_id`),
  KEY `idx_awbc_payments_status` (`status`),
  KEY `idx_awbc_payments_checkout_request_id` (`checkout_request_id`),
  CONSTRAINT `fk_awbc_payments_customer` FOREIGN KEY (`customer_id`) REFERENCES `awbc_customers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `awbc_settlements` (
  `id` CHAR(36) NOT NULL,
  `payment_id` CHAR(36) NOT NULL,
  `customer_id` CHAR(36) NOT NULL,
  `total_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `savings_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `operations_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_awbc_settlements_payment_id` (`payment_id`),
  KEY `idx_awbc_settlements_customer_id` (`customer_id`),
  CONSTRAINT `fk_awbc_settlements_payment` FOREIGN KEY (`payment_id`) REFERENCES `awbc_payments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_awbc_settlements_customer` FOREIGN KEY (`customer_id`) REFERENCES `awbc_customers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `awbc_refunds` (
  `id` CHAR(36) NOT NULL,
  `payment_id` CHAR(36) NOT NULL,
  `customer_id` CHAR(36) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `reason` TEXT NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `requested_by` VARCHAR(100) DEFAULT NULL,
  `approved_by` VARCHAR(100) DEFAULT NULL,
  `approved_at` DATETIME(3) DEFAULT NULL,
  `issued_refund_id` CHAR(36) DEFAULT NULL,
  `created_by` VARCHAR(100) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_awbc_refunds_payment_id` (`payment_id`),
  KEY `idx_awbc_refunds_status` (`status`),
  CONSTRAINT `fk_awbc_refunds_payment` FOREIGN KEY (`payment_id`) REFERENCES `awbc_payments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_awbc_refunds_customer` FOREIGN KEY (`customer_id`) REFERENCES `awbc_customers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `awbc_ledger_entries` (
  `id` CHAR(36) NOT NULL,
  `type` VARCHAR(50) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `direction` VARCHAR(10) NOT NULL,
  `account` VARCHAR(50) NOT NULL,
  `reference_id` VARCHAR(100) NOT NULL DEFAULT '',
  `note` TEXT NOT NULL,
  `metadata` LONGTEXT DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_awbc_ledger_entries_reference_id` (`reference_id`),
  KEY `idx_awbc_ledger_entries_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `awbc_finance_state` (
  `id` TINYINT NOT NULL,
  `policy` LONGTEXT NOT NULL,
  `balances` LONGTEXT NOT NULL,
  `last_auto_settlement_date` VARCHAR(16) NOT NULL DEFAULT '',
  `initialized_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
