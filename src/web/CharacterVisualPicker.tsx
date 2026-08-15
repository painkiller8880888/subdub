import { useEffect, useState } from "react";

import type {
  CharacterVariant,
  CharacterVisualSet
} from "../schema/character-visual.js";
import {
  characterVisualFileUrl,
  sortCharacterVariantsForTags
} from "./character-visual-picker";

function variantFiles(variant: CharacterVariant) {
  return variant.renderType === "single-image"
    ? [{ key: "single", label: "素材" }]
    : [
        { key: "closed", label: "口閉じ" },
        { key: "open", label: "口開き" }
      ];
}

export function CharacterVisualPickerModal({
  visual,
  characterName,
  selectedVariantId,
  onSelect,
  onClose
}: {
  readonly visual: CharacterVisualSet | undefined;
  readonly characterName: string;
  readonly selectedVariantId: string | null | undefined;
  readonly onSelect: (variantId: string) => void;
  readonly onClose: () => void;
}) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    setSelectedTags([]);
  }, [visual?.visualId]);

  if (visual === undefined) {
    return null;
  }

  const activeVariants =
    visual.status === "active"
      ? visual.variants.filter((variant) => variant.status === "active")
      : [];
  const tags = [...new Set(activeVariants.flatMap((variant) => variant.tags))];
  const variants = sortCharacterVariantsForTags(activeVariants, selectedTags);

  return (
    <div
      aria-label={`${characterName}のビジュアルを選択`}
      aria-modal="true"
      className="character-visual-picker-backdrop"
      role="dialog"
    >
      <section className="character-visual-picker-modal">
        <header className="character-visual-picker-header">
          <div>
            <p className="eyebrow">ビジュアルを変更</p>
            <h2>{characterName}の候補</h2>
            <p>タグは候補を隠さず、一致するものを上位に並べます。</p>
          </div>
          <button className="button" type="button" onClick={onClose}>
            閉じる
          </button>
        </header>

        {tags.length > 0 ? (
          <fieldset className="character-visual-picker-tags">
            <legend>タグで並べ替え</legend>
            {tags.map((tag) => (
              <label className="checkbox-field" key={tag}>
                <input
                  checked={selectedTags.includes(tag)}
                  type="checkbox"
                  onChange={(event) => {
                    setSelectedTags((current) =>
                      event.target.checked
                        ? [...current, tag]
                        : current.filter((candidate) => candidate !== tag)
                    );
                  }}
                />
                {tag}
              </label>
            ))}
          </fieldset>
        ) : null}

        {visual.status !== "active" ? (
          <p className="message-panel message-panel-warning" role="status">
            この visual set は inactive のため選択できません。
          </p>
        ) : null}
        {visual.status === "active" && variants.length === 0 ? (
          <p className="status-message">
            利用可能な active variant はありません。
          </p>
        ) : null}

        <div className="character-visual-picker-list">
          {variants.map((variant) => (
            <article
              className={`character-visual-picker-card${
                variant.variantId === selectedVariantId
                  ? " character-visual-picker-card-selected"
                  : ""
              }`}
              key={variant.variantId}
            >
              <header>
                <div>
                  <h3>{variant.label}</h3>
                  <p>
                    {variant.renderType} ·{" "}
                    {variant.tags.join("、") || "タグなし"}
                  </p>
                </div>
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => {
                    onSelect(variant.variantId);
                    onClose();
                  }}
                >
                  {variant.variantId === selectedVariantId
                    ? "選択中"
                    : "このビジュアルを選択"}
                </button>
              </header>
              <div
                className={
                  variant.renderType === "mouth-pair"
                    ? "character-visual-picker-images character-mouth-grid"
                    : "character-visual-picker-images"
                }
              >
                {variantFiles(variant).map((slot) => {
                  const file = variant.files.find(
                    (candidate) => candidate.key === slot.key
                  );
                  return (
                    <figure key={slot.key}>
                      {file === undefined ? (
                        <div className="character-asset-error" role="img">
                          素材が未登録です
                        </div>
                      ) : (
                        <img
                          alt={`${variant.label}・${slot.label}`}
                          className="character-visual-picker-image"
                          src={characterVisualFileUrl(
                            visual.visualId,
                            variant.variantId,
                            file.key
                          )}
                        />
                      )}
                      <figcaption>{slot.label}</figcaption>
                    </figure>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
