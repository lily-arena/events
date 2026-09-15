import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("artifacts/preview", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--single-process"],
});
const errors = [];
const results = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const rootResponse = await page.request.get("http://127.0.0.1:5190/");
assert.equal(rootResponse.status(), 404);
assert.equal(await rootResponse.text(), "");
results.push("Public root returns empty 404");
for (const width of [1440, 390, 320]) {
  await page.setViewportSize({ width, height: 1000 });
  for (const [name, path] of [
    ["first-seat", "/first-seat"],
    ["voting", "/first-seat?stage=voting"],
    ["result", "/first-seat?stage=result"],
    ["admin", "/admin"],
  ]) {
    await page.goto("http://127.0.0.1:5190" + path);
    await page.waitForSelector("h1");
    await page.evaluate(() => document.fonts.ready);
    assert.equal(
      await page
        .locator(".eyebrow,.section-index,.hero-meta,.public-all")
        .count(),
      0,
    );
    if (name !== "admin") {
      assert.equal(await page.locator(".public-footer button").count(), 2);
      assert.equal(await page.locator("a[href='/']").count(), 0);
      const style = await page
        .locator(".event-page")
        .evaluate((el) => ({
          bg: getComputedStyle(el).backgroundColor,
          font: getComputedStyle(el).fontFamily,
          spacing: getComputedStyle(el).letterSpacing,
        }));
      assert.equal(style.bg, "rgb(0, 0, 0)");
      assert.equal(style.spacing, "normal");
      assert.ok(style.font.includes("Pretendard Variable"));
    } else {
      assert.equal(
        await page.getByText("컴포넌트 라이브러리", { exact: true }).count(),
        0,
      );
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(overflow, false, `${name} overflow at ${width}`);
    await page.screenshot({
      path: `artifacts/preview/${name}-${width}.png`,
      fullPage: true,
    });
    results.push(`${name} ${width}: no horizontal overflow`);
  }
}
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto("http://127.0.0.1:5190/admin");
await page.getByRole("button", { name: "편집", exact: true }).click();
await page
  .locator(".settings-content")
  .getByLabel("제목", { exact: true })
  .fill("FIRST SEAT — 검토");
await page
  .locator(".preview-document")
  .getByText("FIRST SEAT — 검토", { exact: true })
  .waitFor();
await page.getByRole("button", { name: "검토용 저장", exact: true }).click();
await page.reload();
await page.getByRole("button", { name: "편집", exact: true }).click();
await page
  .locator(".preview-document")
  .getByText("FIRST SEAT — 검토", { exact: true })
  .waitFor();
results.push("Editor title change persists as browser-only non-PII draft");
await page
  .locator(".settings-content")
  .getByLabel("제목", { exact: true })
  .fill("서울아레나, 첫 좌석에 새길 한 문장을 보내주세요.");
await page.getByRole("button", { name: "검토용 저장", exact: true }).click();
await page.getByRole("button", { name: "모듈 추가", exact: true }).click();
await page
  .getByRole("dialog")
  .getByRole("button", { name: "본문", exact: true })
  .click();
assert.equal(await page.locator(".module-item").count(), 5);
await page.getByRole("button", { name: "위로 이동", exact: true }).click();
assert.equal(
  await page.locator(".module-item").nth(3).locator("strong").textContent(),
  "본문",
);
await page.getByRole("button", { name: "모듈 삭제", exact: true }).click();
assert.equal(await page.locator(".module-item").count(), 4);
results.push("Add/reorder/delete modules work");
await page.locator('.module-item').first().click();
await page.getByLabel('제목 크기',{exact:true}).selectOption('h2');
await page.getByLabel('제목 색상',{exact:true}).selectOption('default');
assert.equal(await page.locator('.preview-document .event-hero .module-title').evaluate(el=>getComputedStyle(el).color),'rgb(181, 181, 181)');
await page.getByLabel('제목 크기',{exact:true}).selectOption('body');
await page.getByLabel('제목 색상',{exact:true}).selectOption('emphasis');
assert.equal(await page.locator('.preview-document .event-hero .module-title').evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
await page.getByRole('tab',{name:'03결과'}).click();
const sizes=await page.locator('.preview-document .result-module .module-title, .preview-document .event-section:last-child .module-title').evaluateAll(els=>els.map(el=>parseFloat(getComputedStyle(el).fontSize)));
assert.ok(sizes.length===2&&sizes[0]>sizes[1]);
results.push('Shared heading sizes and emphasis controls work; result hierarchy differs');

await page.getByRole("tab", { name: "02투표" }).click();
await page.locator(".module-item").filter({ hasText: "참여자 입력" }).click();
await page
  .locator(".settings-content")
  .getByLabel("중복 투표", { exact: true })
  .selectOption("allow");
await page
  .locator(".preview-document")
  .getByText("중복 투표 허용", { exact: false })
  .waitFor();
results.push("Voting fields and repeat-vote setting render");
await page.getByRole("tab", { name: "01공모" }).click();
await page.locator(".module-item").first().click();
await page.locator(".toast").waitFor({ state: "hidden" });
await page.screenshot({
  path: "artifacts/preview/editor-1440.png",
  fullPage: true,
});
await page.setViewportSize({ width: 390, height: 1000 });
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false,
);
await page.screenshot({
  path: "artifacts/preview/editor-390.png",
  fullPage: true,
});
await page.getByRole("button", { name: "이벤트 목록", exact: true }).click();
await page.getByRole("button", { name: "이벤트 생성", exact: true }).click();
await page
  .getByRole("dialog")
  .getByLabel("이벤트 이름", { exact: true })
  .fill("여름의 첫 만남");
await page
  .getByRole("dialog")
  .getByLabel("이벤트 주소", { exact: true })
  .fill("summer-meeting");
await page
  .getByRole("dialog")
  .getByRole("button", { name: "검토용 이벤트 생성" })
  .click();
await page
  .getByRole("heading", { name: "여름의 첫 만남 페이지 편집", exact: true })
  .waitFor();
results.push("Template event creation opens independent draft");
assert.deepEqual(errors, []);
await writeFile(
  "artifacts/preview/results.json",
  JSON.stringify({ results, errors }, null, 2),
);
await browser.close();
console.log(JSON.stringify({ results, errors }, null, 2));
