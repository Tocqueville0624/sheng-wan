import { expect, test } from "@playwright/test";

test("all gull decorations load the same local transparent asset", async ({ page }) => {
  for (const route of ["/", "/playground/hugo-le-chatssius/", "/not-a-real-page"]) {
    await page.goto(route);
    const birds = page.locator(".dove-mark");
    await expect(birds).toHaveCount(2);
    for (const bird of await birds.all()) {
      await expect(bird).toHaveAttribute("aria-hidden", "true");
      await expect(bird).toHaveAttribute("focusable", "false");
      await expect(bird.locator("image")).toHaveAttribute(
        "href",
        "/media/decorative/seagulls.webp?v=painted-2"
      );
    }
    const loaded = await page.evaluate(async () => {
      const image = new Image();
      image.src = document.querySelector(".dove-mark image")!.getAttribute("href")!;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        transparentCorner: context.getImageData(0, 0, 1, 1).data[3] === 0
      };
    });
    expect(loaded).toEqual({ width: 1060, height: 371, transparentCorner: true });
  }
});

test("the social preview embeds the matching gulls without external image dependencies", async ({
  page
}) => {
  await page.goto("/social-card.svg");
  const bird = page.locator("image");
  await expect(bird).toHaveCount(1);
  await expect(bird).toHaveAttribute("href", /^data:image\/webp;base64,/);
  const dimensions = await bird.evaluate(async (element) => {
    const image = new Image();
    image.src = element.getAttribute("href")!;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  });
  expect(dimensions).toEqual([570, 200]);
});
