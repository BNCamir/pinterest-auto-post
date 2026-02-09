export type CanvaPinInput = {
  baseUrl: string;
  /** Direct API key (Bearer token) */
  apiKey?: string;
  /** Or OAuth credentials */
  clientId?: string;
  clientSecret?: string;
  /** Refresh token from initial OAuth flow (for server automation) */
  refreshToken?: string;
  /** If set, new refresh tokens from the API will be written here so you don't need to re-run OAuth */
  refreshTokenSavePath?: string;
  templateId: string;
  imageDataBase64: string;
  headline: string;
  brandName: string;
};

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/**
 * Exchange Client ID + Secret + Refresh Token for an access token (OAuth 2.0).
 * Caches the token until it expires.
 */
async function getCanvaAccessToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  refreshToken?: string,
  refreshTokenSavePath?: string
): Promise<string> {
  // Check cache
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60000) {
    return cachedAccessToken.token;
  }

  // Canva Connect API token endpoint: https://api.canva.com/rest/v1/oauth/token
  // Uses Basic Auth: Base64(client_id:client_secret)
  const tokenUrl = "https://api.canva.com/rest/v1/oauth/token";
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    // Use refresh token if available (for server automation), otherwise try client_credentials
    const grantType = refreshToken ? "refresh_token" : "client_credentials";
    const bodyParams = new URLSearchParams({ grant_type: grantType });
    if (refreshToken) {
      bodyParams.append("refresh_token", refreshToken);
    }

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`
      },
      body: bodyParams
    });

    if (response.ok) {
      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      if (data.access_token) {
        const expiresIn = (data.expires_in ?? 14400) * 1000; // Default 4 hours
        cachedAccessToken = {
          token: data.access_token,
          expiresAt: Date.now() + expiresIn
        };
        // Canva rotates refresh tokens: save the new one so next run uses it
        if (data.refresh_token && refreshTokenSavePath) {
          const { writeFileSync } = await import("fs");
          try {
            writeFileSync(refreshTokenSavePath, data.refresh_token, "utf8");
          } catch {
            // ignore write errors
          }
        }
        return data.access_token;
      }
      throw new Error("Canva OAuth response missing access_token");
    } else {
      const errorText = await response.text();
      throw new Error(`Canva OAuth failed: ${response.status} ${errorText}`);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to get Canva access token: ${errorMessage}`);
  }
}

export type CanvaPinResult = {
  exportUrl: string;
  width: number;
  height: number;
};

export async function createPinFromTemplate(input: CanvaPinInput): Promise<CanvaPinResult> {
  // Get access token (either direct API key or OAuth)
  let accessToken: string;
  if (input.apiKey) {
    accessToken = input.apiKey;
  } else if (input.clientId && input.clientSecret) {
    accessToken = await getCanvaAccessToken(
      input.baseUrl,
      input.clientId,
      input.clientSecret,
      input.refreshToken,
      input.refreshTokenSavePath
    );
  } else {
    throw new Error("Canva requires either apiKey or (clientId + clientSecret [+ refreshToken])");
  }

  const baseUrl = input.baseUrl.replace(/\/$/, "");

  // Step 1: Get template dataset to see what fields are available
  const datasetUrl = `${baseUrl}/brand-templates/${input.templateId}/dataset`;
  const datasetResponse = await fetch(datasetUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!datasetResponse.ok) {
    const text = await datasetResponse.text();
    throw new Error(`Canva get template dataset failed: ${datasetResponse.status} ${text}`);
  }

  const dataset = (await datasetResponse.json()) as {
    fields?: Array<{ key: string; type: string; label?: string }>;
  };

  // Step 2: Upload image as asset
  const imageBytes = Buffer.from(input.imageDataBase64, "base64");
  const assetName = `pin-image-${Date.now()}.png`.slice(0, 50); // max 50 chars
  const nameBase64 = Buffer.from(assetName, "utf8").toString("base64");
  const assetMetadata = JSON.stringify({ name_base64: nameBase64 });

  const assetUploadUrl = `${baseUrl}/asset-uploads`;
  const assetUploadResponse = await fetch(assetUploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
      "Asset-Upload-Metadata": assetMetadata
    },
    body: imageBytes
  });

  if (!assetUploadResponse.ok) {
    const text = await assetUploadResponse.text();
    throw new Error(`Canva asset upload failed: ${assetUploadResponse.status} ${text}`);
  }

  const assetUploadData = (await assetUploadResponse.json()) as {
    job_id?: string;
    jobId?: string;
    job?: { id?: string };
  };
  const assetJobId =
    assetUploadData.job?.id ?? assetUploadData.job_id ?? assetUploadData.jobId;
  if (!assetJobId) throw new Error("Canva did not return asset upload job_id");

  // Poll for asset upload completion
  let assetId: string | null = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const assetStatusUrl = `${baseUrl}/asset-uploads/${assetJobId}`;
    const assetStatusResponse = await fetch(assetStatusUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!assetStatusResponse.ok) {
      const text = await assetStatusResponse.text();
      throw new Error(`Canva asset status failed: ${assetStatusResponse.status} ${text}`);
    }

    const assetStatus = (await assetStatusResponse.json()) as {
      status?: string;
      job?: { status?: string; asset?: { id?: string }; error?: { message?: string } };
      asset_id?: string;
      assetId?: string;
      error?: string;
    };
    const job = assetStatus.job;
    const status = job?.status ?? assetStatus.status ?? "";
    const completedAssetId =
      job?.asset?.id ?? assetStatus.asset_id ?? assetStatus.assetId;
    if (status === "success" && completedAssetId) {
      assetId = completedAssetId;
      break;
    } else if (status === "failed") {
      const errMsg = job?.error?.message ?? assetStatus.error ?? "Unknown error";
      throw new Error(`Canva asset upload failed: ${errMsg}`);
    }
  }

  if (!assetId) {
    throw new Error("Canva asset upload did not complete within timeout");
  }

  // Step 3: Build autofill data based on template fields
  const autofillData: Record<string, { type: string; asset_id?: string; text?: string }> = {};

  if (dataset.fields && dataset.fields.length > 0) {
    // Use actual template fields
    for (const field of dataset.fields) {
      if (field.type === "image" && assetId) {
        autofillData[field.key] = { type: "image", asset_id: assetId };
      } else if (field.type === "text") {
        autofillData[field.key] = { type: "text", text: input.headline };
      }
    }
  } else {
    // Fallback: try common field names
    autofillData.image = { type: "image", asset_id: assetId };
    autofillData.headline = { type: "text", text: input.headline };
    autofillData.title = { type: "text", text: input.headline };
  }

  // Step 4: Create autofill job
  const autofillUrl = `${baseUrl}/autofills`;
  const autofillBody = {
    brand_template_id: input.templateId,
    data: autofillData
  };

  const autofillResponse = await fetch(autofillUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(autofillBody)
  });

  if (!autofillResponse.ok) {
    const text = await autofillResponse.text();
    throw new Error(`Canva autofill failed: ${autofillResponse.status} ${text}`);
  }

  const autofillResponseData = (await autofillResponse.json()) as { job_id?: string; jobId?: string };
  const jobId = autofillResponseData.job_id ?? autofillResponseData.jobId;
  if (!jobId) throw new Error("Canva did not return autofill job_id");

  // Step 2: Poll for job completion
  let designId: string | null = null;
  const maxAttempts = 30;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds

    const jobStatusUrl = `${baseUrl}/autofills/${jobId}`;
    const jobStatusResponse = await fetch(jobStatusUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!jobStatusResponse.ok) {
      const text = await jobStatusResponse.text();
      throw new Error(`Canva autofill status failed: ${jobStatusResponse.status} ${text}`);
    }

    const jobStatus = (await jobStatusResponse.json()) as {
      status: string;
      design_id?: string;
      designId?: string;
      error?: string;
    };

    const completedDesignId = jobStatus.design_id ?? jobStatus.designId;
    if (jobStatus.status === "completed" && completedDesignId) {
      designId = completedDesignId;
      break;
    } else if (jobStatus.status === "failed") {
      throw new Error(`Canva autofill job failed: ${jobStatus.error ?? "Unknown error"}`);
    }
    // Continue polling if status is "pending" or "processing"
  }

  if (!designId) {
    throw new Error("Canva autofill job did not complete within timeout");
  }

  // Step 3: Create export job
  const exportCreateUrl = `${baseUrl}/exports`;
  const exportBody = {
    designId,
    format: "png"
  };

  const exportResponse = await fetch(exportCreateUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(exportBody)
  });

  if (!exportResponse.ok) {
    const text = await exportResponse.text();
    throw new Error(`Canva export failed: ${exportResponse.status} ${text}`);
  }

  const exportData = (await exportResponse.json()) as { export_id?: string; exportId?: string };
  const exportId = exportData.export_id ?? exportData.exportId;
  if (!exportId) throw new Error("Canva did not return export_id");

  // Step 4: Poll for export completion
  let finalExportUrl: string | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds

    const exportStatusUrl = `${baseUrl}/exports/${exportId}`;
    const exportStatusResponse = await fetch(exportStatusUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!exportStatusResponse.ok) {
      const text = await exportStatusResponse.text();
      throw new Error(`Canva export status failed: ${exportStatusResponse.status} ${text}`);
    }

    const exportStatus = (await exportStatusResponse.json()) as {
      status: string;
      url?: string;
      download_url?: string;
      error?: string;
    };

    const completedUrl = exportStatus.url ?? exportStatus.download_url;
    if (exportStatus.status === "completed" && completedUrl) {
      finalExportUrl = completedUrl;
      break;
    } else if (exportStatus.status === "failed") {
      throw new Error(`Canva export job failed: ${exportStatus.error ?? "Unknown error"}`);
    }
  }

  if (!finalExportUrl) {
    throw new Error("Canva export job did not complete within timeout");
  }

  return {
    exportUrl: finalExportUrl,
    width: 1000,
    height: 1500
  };
}
