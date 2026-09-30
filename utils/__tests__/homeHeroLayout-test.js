import { homeHeroImageSize, homeHeroPhotoFrame } from "../homeHeroLayout";

const PHOTO = { imageWidth: 5378, imageHeight: 3586 };
const frameFor = (width, height, verticalOffset = 9 * 1.14) => homeHeroPhotoFrame({ ...PHOTO, width, height, verticalOffset });

test("Web without an Image asset resolver uses width and height from the bundled source", () => {
  expect(homeHeroImageSize({ uri: "/assets/hk.jpg", width: 5378, height: 3586 }, undefined))
    .toEqual({ width: 5378, height: 3586 });
});

test.each([undefined, null, false])("Web with no callable resolver (%s) and a URL source safely uses original dimensions", (resolver) => {
  expect(homeHeroImageSize("/assets/hk.jpg", resolver)).toEqual({ width: 5378, height: 3586 });
});

test("native asset metadata takes precedence over the known fallback dimensions", () => {
  const resolver = jest.fn(() => ({ uri: "asset:/hk.jpg", width: 1200, height: 800 }));
  expect(homeHeroImageSize(42, resolver)).toEqual({ width: 1200, height: 800 });
  expect(resolver).toHaveBeenCalledWith(42);
});

test("invalid or failed asset metadata cannot crash Home or combine mismatched width and height", () => {
  expect(homeHeroImageSize({ width: 20 }, () => ({ width: 1200, height: 0 })))
    .toEqual({ width: 5378, height: 3586 });
  expect(homeHeroImageSize({ width: 800, height: 600 }, () => { throw new Error("unavailable metadata"); }))
    .toEqual({ width: 800, height: 600 });
});

test.each([[320, 184], [375, 186], [390, 189], [393, 201], [430, 213], [844, 198], [600, 260], [800, 290], [1280, 290], [1600, 420]])(
  "photo covers %i x %i without changing the source ratio or uncovering an edge",
  (width, height) => {
    const frame = frameFor(width, height);
    expect(frame.width / frame.height).toBeCloseTo(PHOTO.imageWidth / PHOTO.imageHeight, 10);
    expect(frame.left).toBeLessThanOrEqual(0);
    expect(frame.top).toBeLessThanOrEqual(0);
    expect(frame.left + frame.width).toBeGreaterThanOrEqual(width);
    expect(frame.top + frame.height).toBeGreaterThanOrEqual(height);
    const centred = frameFor(width, height, 0);
    expect(frame.top).toBeGreaterThanOrEqual(centred.top);
    expect(frame.width).toBe(centred.width);
    expect(frame.height).toBe(centred.height);
  },
);

test.each([-10000, 10000])("an extreme vertical focal offset %i is clamped without exposing the background", (offset) => {
  const frame = frameFor(320, 201, offset);
  expect(frame.top).toBeLessThanOrEqual(0);
  expect(frame.top + frame.height).toBeGreaterThanOrEqual(201);
});

test("matches the existing centred cover, 1.14 zoom and downward offset composition", () => {
  const frame = frameFor(375, 198);
  const cover = Math.max(375 / PHOTO.imageWidth, 198 / PHOTO.imageHeight);
  expect(frame.width).toBeCloseTo(PHOTO.imageWidth * cover * 1.14, 10);
  expect(frame.height).toBeCloseTo(PHOTO.imageHeight * cover * 1.14, 10);
  expect(frame.top).toBeCloseTo((198 - frame.height) / 2 + 9 * 1.14, 10);
});

test("invalid transient sizes never produce NaN, infinite or negative image dimensions", () => {
  const frame = homeHeroPhotoFrame({ width: 0, height: NaN, imageWidth: undefined, imageHeight: 0, zoom: Infinity, verticalOffset: NaN });
  expect(Object.values(frame).every(Number.isFinite)).toBe(true);
  expect(frame.width).toBeGreaterThan(0);
  expect(frame.height).toBeGreaterThan(0);
});
