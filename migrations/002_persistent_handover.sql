-- Gravity Arena GA OS
-- Persistent WhatsApp human handover state
-- Apply to the Afrihost MySQL database after taking a backup.

ALTER TABLE whatsapp_conversations
  ADD COLUMN handover_status ENUM('AI_ACTIVE','HUMAN_ACTIVE') NOT NULL DEFAULT 'AI_ACTIVE',
  ADD COLUMN handover_team VARCHAR(50) NULL,
  ADD COLUMN handover_reason VARCHAR(255) NULL,
  ADD COLUMN handover_started_at DATETIME NULL,
  ADD COLUMN handover_resolved_at DATETIME NULL,
  ADD COLUMN handover_updated_at DATETIME NULL;

CREATE INDEX idx_whatsapp_conversations_handover_status
  ON whatsapp_conversations (handover_status);

CREATE INDEX idx_whatsapp_conversations_handover_team
  ON whatsapp_conversations (handover_team);
