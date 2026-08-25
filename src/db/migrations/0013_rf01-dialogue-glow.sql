ALTER TABLE `character_visuals`
ADD `glow_color` text NOT NULL DEFAULT '#ffffff';
--> statement-breakpoint

UPDATE `character_visuals`
SET `glow_color` = CASE `visual_id`
  WHEN 'character-mentor' THEN '#e78ac3'
  WHEN 'character-learner' THEN '#75c97a'
  ELSE '#ffffff'
END;
--> statement-breakpoint

UPDATE `screen_template_elements`
SET `config_json` = json_set(
  `config_json`,
  '$.backgroundColor', '#000000',
  '$.backgroundOpacity', 0.4
)
WHERE `element_type` = 'dialogue-window';
