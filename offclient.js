const OFF_BASE_URL = 'https://world.openfoodfacts.org/api/v2/product';

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickFirstNumber(obj, keys) {
  for (const key of keys) {
    const value = parseNumber(obj?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function pickPer100gNumber(obj, key100g) {
  return parseNumber(obj?.[key100g]);
}

function normalizePer100g(product, barcode) {
  const nutriments = product?.nutriments || {};

  const kcal = pickFirstNumber(nutriments, ['energy-kcal_100g', 'energy-kcal']);
  const kj = pickFirstNumber(nutriments, ['energy-kj_100g', 'energy-kj']);
  const kcalNormalized = kcal ?? (kj !== null ? kj / 4.184 : null);

  return {
    barcode,
    productName: product?.product_name || 'Unknown product',
    brands: product?.brands || '',
    imageUrl: product?.image_front_small_url || product?.image_front_url || '',
    nutrition: {
      kcal100g: kcalNormalized,
      p100g: pickFirstNumber(nutriments, ['proteins_100g', 'proteins']),
      c100g: pickFirstNumber(nutriments, ['carbohydrates_100g', 'carbohydrates']),
      f100g: pickFirstNumber(nutriments, ['fat_100g', 'fat']),
      saturatedFat100g: pickPer100gNumber(nutriments, 'saturated-fat_100g'),
      monounsaturatedFat100g: pickPer100gNumber(nutriments, 'monounsaturated-fat_100g'),
      polyunsaturatedFat100g: pickPer100gNumber(nutriments, 'polyunsaturated-fat_100g'),
      omega3100g: pickPer100gNumber(nutriments, 'omega-3-fat_100g'),
      omega6100g: pickPer100gNumber(nutriments, 'omega-6-fat_100g'),
      transFat100g: pickPer100gNumber(nutriments, 'trans-fat_100g')
    },
    source: 'Open Food Facts',
    fetchedAt: Date.now()
  };
}

export async function lookupOpenFoodFacts(barcode) {
  const response = await fetch(`${OFF_BASE_URL}/${encodeURIComponent(barcode)}.json`);
  if (!response.ok) {
    throw new Error(`OFF lookup failed: ${response.status}`);
  }

  const data = await response.json();
  if (data?.status !== 1 || !data?.product) {
    throw new Error('Product not found in Open Food Facts');
  }

  return normalizePer100g(data.product, barcode);
}
