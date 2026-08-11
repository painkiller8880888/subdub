import { useEffect, useState } from "react";
import {
  cancelRender,
  continueRender,
  delayRender,
  staticFile
} from "remotion";

export const REMOTION_FONT_FAMILY = "SubDub Noto Sans JP";

const REMOTION_FONT_PATH = "shared-assets/fonts/NotoSansJP-VF.ttf";

/**
 * Load the checked-in font before Remotion captures a frame. Relying on the
 * browser's system-font fallback makes Japanese glyph availability and
 * rasterization vary between Windows and Ubuntu CI.
 */
export function RemotionFontLoader(): null {
  const [handle] = useState(() =>
    delayRender("Loading bundled SubDub Noto Sans JP", {
      timeoutInMilliseconds: 30_000
    })
  );

  useEffect(() => {
    let active = true;
    const font = new FontFace(
      REMOTION_FONT_FAMILY,
      `url("${staticFile(REMOTION_FONT_PATH)}")`,
      {
        style: "normal",
        weight: "100 900"
      }
    );
    document.fonts.add(font);

    void font
      .load()
      .then(() => document.fonts.load(`16px "${REMOTION_FONT_FAMILY}"`))
      .then(() => {
        if (active) {
          continueRender(handle);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          cancelRender(error);
        }
      });

    return () => {
      active = false;
    };
  }, [handle]);

  return null;
}
