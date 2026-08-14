import { LiquidMetal } from "@paper-design/shaders-react";
import { useEffect, useState } from "react";

type LiquidMetalMarkProps = {
  variant?: "mark" | "hero";
};

export function LiquidMetalMark({ variant = "mark" }: LiquidMetalMarkProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setReduceMotion(mediaQuery.matches);
    const updateTheme = () => setIsDark(document.documentElement.classList.contains("dark"));
    const themeObserver = new MutationObserver(updateTheme);

    updateMotionPreference();
    updateTheme();
    mediaQuery.addEventListener("change", updateMotionPreference);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      mediaQuery.removeEventListener("change", updateMotionPreference);
      themeObserver.disconnect();
    };
  }, []);

  const isHero = variant === "hero";

  return (
    <span className={isHero ? "home-hero-shader" : "brand-shader-mark"} aria-hidden="true">
      <LiquidMetal
        width="100%"
        height="100%"
        colorBack={isDark ? "#0d100d" : "#dce8d6"}
        colorTint={isDark ? "#ace35c" : "#264500"}
        shape="diamond"
        repetition={3.4}
        softness={0.16}
        distortion={0.2}
        contour={0.72}
        shiftRed={0.1}
        shiftBlue={-0.16}
        angle={112}
        speed={reduceMotion ? 0 : 0.55}
        scale={isHero ? 0.68 : 0.86}
        rotation={45}
        offsetX={isHero ? -0.27 : 0}
        offsetY={0}
        fit="contain"
        maxPixelCount={isHero ? 1_400_000 : 16_384}
      />
    </span>
  );
}
