CREATE VIRTUAL TABLE `asset_search` USING fts5(
	`asset_id` UNINDEXED,
	`title`,
	`description`,
	`department`,
	`system`,
	`tags`,
	tokenize = 'trigram'
);
--> statement-breakpoint
CREATE VIEW `asset_search_documents` AS
SELECT
	assets.asset_id AS asset_id,
	assets.title AS title,
	assets.description AS description,
	COALESCE(assets.department, '') AS department,
	COALESCE(assets.system, '') AS system,
	COALESCE(
		(
			SELECT group_concat(value, ' ')
			FROM (
				SELECT tags.canonical_name AS value
				FROM asset_tags
				INNER JOIN tags ON tags.tag_id = asset_tags.tag_id
				WHERE asset_tags.asset_id = assets.asset_id
					AND tags.status = 'active'
				UNION ALL
				SELECT tag_aliases.alias AS value
				FROM asset_tags
				INNER JOIN tags ON tags.tag_id = asset_tags.tag_id
				INNER JOIN tag_aliases ON tag_aliases.tag_id = tags.tag_id
				WHERE asset_tags.asset_id = assets.asset_id
					AND tags.status = 'active'
				ORDER BY value
			)
		),
		''
	) AS tags
FROM assets;
--> statement-breakpoint
CREATE TRIGGER `asset_search_assets_ai`
AFTER INSERT ON assets
BEGIN
	INSERT INTO asset_search (asset_id, title, description, department, system, tags)
	SELECT asset_id, title, description, department, system, tags
	FROM asset_search_documents
	WHERE asset_id = NEW.asset_id;
END;
--> statement-breakpoint
CREATE TRIGGER `asset_search_assets_au`
AFTER UPDATE ON assets
BEGIN
	DELETE FROM asset_search WHERE asset_id = OLD.asset_id;
	INSERT INTO asset_search (asset_id, title, description, department, system, tags)
	SELECT asset_id, title, description, department, system, tags
	FROM asset_search_documents
	WHERE asset_id = NEW.asset_id;
END;
--> statement-breakpoint
CREATE TRIGGER `asset_search_assets_ad`
AFTER DELETE ON assets
BEGIN
	DELETE FROM asset_search WHERE asset_id = OLD.asset_id;
END;
--> statement-breakpoint
CREATE TRIGGER `asset_search_tags_ai`
AFTER INSERT ON tags
BEGIN
	DELETE FROM asset_search
	WHERE asset_id IN (
		SELECT asset_id FROM asset_tags WHERE tag_id = NEW.tag_id
	);
	INSERT INTO asset_search (asset_id, title, description, department, system, tags)
	SELECT asset_id, title, description, department, system, tags
	FROM asset_search_documents
	WHERE asset_id IN (
		SELECT asset_id FROM asset_tags WHERE tag_id = NEW.tag_id
	);
END;
--> statement-breakpoint
CREATE TRIGGER `asset_search_tags_au`
AFTER UPDATE ON tags
BEGIN
	DELETE FROM asset_search
	WHERE asset_id IN (
		SELECT asset_id FROM asset_tags WHERE tag_id IN (OLD.tag_id, NEW.tag_id)
	);
	INSERT INTO asset_search (asset_id, title, description, department, system, tags)
	SELECT asset_id, title, description, department, system, tags
	FROM asset_search_documents
	WHERE asset_id IN (
		SELECT asset_id FROM asset_tags WHERE tag_id IN (OLD.tag_id, NEW.tag_id)
	);
END;
--> statement-breakpoint
CREATE TRIGGER `asset_search_tags_ad`
AFTER DELETE ON tags
BEGIN
	DELETE FROM asset_search
	WHERE asset_id IN (
		SELECT asset_id FROM asset_tags WHERE tag_id = OLD.tag_id
	);
END;
--> statement-breakpoint
CREATE TRIGGER `asset_search_tag_aliases_ai`
AFTER INSERT ON tag_aliases
BEGIN
	DELETE FROM asset_search
	WHERE asset_id IN (
		SELECT asset_id FROM asset_tags WHERE tag_id = NEW.tag_id
	);
	INSERT INTO asset_search (asset_id, title, description, department, system, tags)
	SELECT asset_id, title, description, department, system, tags
	FROM asset_search_documents
	WHERE asset_id IN (
		SELECT asset_id FROM asset_tags WHERE tag_id = NEW.tag_id
	);
END;
--> statement-breakpoint
CREATE TRIGGER `asset_search_tag_aliases_au`
AFTER UPDATE ON tag_aliases
BEGIN
	DELETE FROM asset_search
	WHERE asset_id IN (
		SELECT asset_id FROM asset_tags WHERE tag_id IN (OLD.tag_id, NEW.tag_id)
	);
	INSERT INTO asset_search (asset_id, title, description, department, system, tags)
	SELECT asset_id, title, description, department, system, tags
	FROM asset_search_documents
	WHERE asset_id IN (
		SELECT asset_id FROM asset_tags WHERE tag_id IN (OLD.tag_id, NEW.tag_id)
	);
END;
--> statement-breakpoint
CREATE TRIGGER `asset_search_tag_aliases_ad`
AFTER DELETE ON tag_aliases
BEGIN
	DELETE FROM asset_search
	WHERE asset_id IN (
		SELECT asset_id FROM asset_tags WHERE tag_id = OLD.tag_id
	);
	INSERT INTO asset_search (asset_id, title, description, department, system, tags)
	SELECT asset_id, title, description, department, system, tags
	FROM asset_search_documents
	WHERE asset_id IN (
		SELECT asset_id FROM asset_tags WHERE tag_id = OLD.tag_id
	);
END;
--> statement-breakpoint
CREATE TRIGGER `asset_search_asset_tags_ai`
AFTER INSERT ON asset_tags
BEGIN
	DELETE FROM asset_search WHERE asset_id = NEW.asset_id;
	INSERT INTO asset_search (asset_id, title, description, department, system, tags)
	SELECT asset_id, title, description, department, system, tags
	FROM asset_search_documents
	WHERE asset_id = NEW.asset_id;
END;
--> statement-breakpoint
CREATE TRIGGER `asset_search_asset_tags_au`
AFTER UPDATE ON asset_tags
BEGIN
	DELETE FROM asset_search WHERE asset_id IN (OLD.asset_id, NEW.asset_id);
	INSERT INTO asset_search (asset_id, title, description, department, system, tags)
	SELECT asset_id, title, description, department, system, tags
	FROM asset_search_documents
	WHERE asset_id IN (OLD.asset_id, NEW.asset_id);
END;
--> statement-breakpoint
CREATE TRIGGER `asset_search_asset_tags_ad`
AFTER DELETE ON asset_tags
BEGIN
	DELETE FROM asset_search WHERE asset_id = OLD.asset_id;
	INSERT INTO asset_search (asset_id, title, description, department, system, tags)
	SELECT asset_id, title, description, department, system, tags
	FROM asset_search_documents
	WHERE asset_id = OLD.asset_id;
END;
--> statement-breakpoint
INSERT INTO asset_search (asset_id, title, description, department, system, tags)
SELECT asset_id, title, description, department, system, tags
FROM asset_search_documents;
