import { readdir, readFile } from "fs/promises";
import { join } from "path";

const TEMPLATES_DIR = join(process.cwd(), "templates");

/**
 * Get a local template image file path, rotating through available templates based on runId.
 */
export async function getLocalTemplatePath(runId: number): Promise<string | null> {
  try {
    const files = await readdir(TEMPLATES_DIR);
    const imageFiles = files.filter((f) => /\.(jpg|jpeg|png)$/i.test(f)).sort();
    
    if (imageFiles.length === 0) {
      console.error(`[Local Templates] No template images found in ${TEMPLATES_DIR}`);
      return null;
    }
    
    const selectedIndex = runId % imageFiles.length;
    const selectedFile = imageFiles[selectedIndex];
    const templatePath = join(TEMPLATES_DIR, selectedFile!);
    
    console.error(`[Local Templates] Selected template ${selectedIndex + 1}/${imageFiles.length}: ${selectedFile} (runId ${runId})`);
    return templatePath;
  } catch (err) {
    console.error(`[Local Templates] Error reading templates directory: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Read a local template image file and return it as base64.
 */
export async function getLocalTemplateBase64(templatePath: string): Promise<{ data: string; mimeType: string }> {
  const buffer = await readFile(templatePath);
  const base64 = buffer.toString("base64");
  
  // Determine MIME type from file extension
  const ext = templatePath.toLowerCase().split(".").pop();
  const mimeType = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/jpeg";
  
  return { data: base64, mimeType };
}
