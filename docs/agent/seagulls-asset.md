# Decorative seagulls — painted revision

The user requested hand-drawn birds instead of the earlier photographic cutouts, then identified a duplicated head in the small lower-right gull. The current asset uses ivory and slate-blue gouache-style shapes and visible brushwork. All three birds were independently checked for one head/beak, two wings, and one tail; the corrected small bird is an unambiguous right-facing glide.

Artwork was generated with the built-in image-generation tool on 2026-09-02. The local `视觉参考.jpg` and bird crops informed the palette and printed mood only. No album lettering, portrait, or cover composition is included. The source photographs and reference images remain local-only and unchanged.

## Selected artwork and transparency

The selected corrected generation is `exec-8b4ed41d-a459-4e51-a132-8b5e3887af56.png`, 2139 × 735 px. The generator repeatedly returned a baked checkerboard rather than an alpha channel. The user explicitly authorized precise background extraction without further redrawing. A deterministic color/connected-component matte removed the neutral checkerboard, filled enclosed neutral paint, retained the three bird components, and decontaminated the antialiased boundary. Interior painted RGB and geometry were retained. The extracted master has real alpha values from 0 to 255 and was inspected on both pale blue and dark navy backgrounds.

The shipped asset is `public/media/decorative/seagulls.webp`: 1060 × 371 px, uniformly fitted with transparent padding, WebP quality 90 / alpha quality 100, no source metadata. It is not stretched. `DoveMark.astro` shares the asset across Home, Hugo, the footer, and 404; its version query refreshes the previous photographic image. The social-card SVG embeds a 570 × 200 px derivative for self-contained rendering. Decorations remain static, non-interactive and hidden from assistive technology. `pnpm media:check` and browser tests validate dimensions, alpha and loading.

Temporary extraction script and review composites: `/private/tmp/painted-gulls-matte.C3yuws/`. The generator originals remain in the Codex generated-images directory; rejected variants are not referenced by the website.

## Final anatomy-correction prompt

Fix a precise anatomy error in the SMALL LOWER-RIGHT GULL ONLY. Completely redraw that one small gull in a simple clean right-facing side-profile gliding pose: exactly ONE head at its right/front with ONE beak and ONE visible eye, exactly ONE body, TWO clearly attached wings (one rising to upper-left, the other extending down-left), and ONE simple short fan-shaped tail at its left/rear. Its left/rear MUST NOT have any head-like bulge, beak, eye, face, or dark eye-shaped mark. Make the anatomy unmistakable at small size. Match the same hand-painted ivory and slate-blue gouache / dry-brush illustration, not realism. Preserve the large left and medium upper-right birds and their colors, shapes and relative positions. Preserve the wide 2.85:1 composition. Output as a truly transparent RGBA image: remove the existing background pattern entirely, alpha zero around and between the birds. Only three anatomically correct painted birds, no other content.

Input: `exec-5c22e78c-fb33-47ed-af88-ba7cfd8f21b9.png`, the painted variant marked by the user. Transparency was subsequently corrected through the user-approved extraction described above, not claimed as successful generator output.
