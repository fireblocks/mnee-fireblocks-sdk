/**
 * Dynamically load the oneSatOrd module
 * @returns Promise resolving to the oneSatOrd module
 */
export async function loadOneSatOrd() {
  try {
    // Create a wrapper that will safely handle both ESM and CommonJS modules
    // Force dynamic import syntax to avoid CommonJS/ESM conflicts
    const module = await eval('import("js-1sat-ord")');
    return module.default || module;
  } catch (error) {
    console.error('Error loading js-1sat-ord module:', error);
    throw error;
  }
}