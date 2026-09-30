// React Native Web's Image component does not expose resolveAssetSource.
// Bundler metadata is optional; the bundled hk.jpg dimensions remain a safe
// fallback so resolving this decorative image never prevents Home loading.
export function homeHeroImageSize(source, resolveAssetSource) {
  let resolved;
  if (typeof resolveAssetSource === "function") {
    try { resolved = resolveAssetSource(source); } catch { /* Use the bundled dimensions below. */ }
  }
  for (const candidate of [resolved, source]) {
    if (Number.isFinite(candidate?.width) && candidate.width > 0
      && Number.isFinite(candidate?.height) && candidate.height > 0) {
      return { width: candidate.width, height: candidate.height };
    }
  }
  return { width: 5378, height: 3586 };
}

// Calculate one uniformly scaled bitmap, without combining percentage image
// bounds and native transforms. Clamp its focal offset so no edge is uncovered.
export function homeHeroPhotoFrame({ width, height, imageWidth, imageHeight, verticalOffset = 0, zoom = 1.14 }) {
  const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
  const containerWidth = positive(width, 1);
  const containerHeight = positive(height, 1);
  const sourceWidth = positive(imageWidth, 1);
  const sourceHeight = positive(imageHeight, 1);
  const scale = Math.max(containerWidth / sourceWidth, containerHeight / sourceHeight) * Math.max(1, positive(zoom, 1));
  const photoWidth = sourceWidth * scale;
  const photoHeight = sourceHeight * scale;
  const offset = Number.isFinite(verticalOffset) ? verticalOffset : 0;
  return {
    width: photoWidth,
    height: photoHeight,
    left: (containerWidth - photoWidth) / 2,
    top: Math.min(0, Math.max(containerHeight - photoHeight, (containerHeight - photoHeight) / 2 + offset)),
  };
}
