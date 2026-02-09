# Canva Data Connector Setup for Autofill Templates

To use Canva templates with our pipeline's Autofill API, you need a **Data Connector app** so Canva recognizes your template's data fields. This is separate from the Connect API integration (OAuth) we already use.

## Ready-to-use: BoxNCase Pin Data Connector

A Data Connector app is included in this project at **`canva-data-connector/`**. It exposes `headline` and `image` fields for pin templates.

**Quick start:**
1. `cd canva-data-connector && npm install && npm start`
2. Create an app at [Developer Portal](https://www.canva.com/developers/apps) with Data Connector intent
3. Set Development URL to `http://localhost:8080` and click Preview
4. See `canva-data-connector/BOXNCASE_SETUP.md` for full steps

---

## Manual setup (alternative)

If you prefer to create the app from scratch:

## Step 1: Create the Data Connector App

1. **Install Canva CLI** (if not already):
   ```bash
   npm install -g @canva/cli@latest
   ```

2. **Log in**:
   ```bash
   canva login
   ```
   (Opens browser to authorize)

3. **Create the app** (run from a folder *outside* this project, e.g. your Desktop):
   ```bash
   cd ~/Desktop
   canva apps create --template "data_connector" --name "boxncase-pin-autofill"
   ```
   Follow the prompts (audience, name, git, npm).

4. **Enter the new app folder**:
   ```bash
   cd boxncase-pin-autofill
   ```

## Step 2: Configure for Pin Data (headline + image)

The template exposes data sources. You need a source that returns columns:

- `headline` (text)
- `image` (image URL or media)

Look for files like:

- `src/api/data_sources/` – add or edit a data source
- `src/intents/data_connector.ts` or similar – defines the connector

Set up a simple source that returns at least one row with:

| headline           | image                    |
|--------------------|--------------------------|
| Sample Pin Title   | https://via.placeholder.com/1000x1500.png |

The exact format depends on the template; see the generated README and `src/api/` for column types.

## Step 3: Connect to Canva Connect API (Optional for Preview)

The template may use Canva Connect API for auth. You can point it to your existing app or use the template’s default for testing.

## Step 4: Run and Preview

```bash
npm start
```

Then:

1. Go to [Canva Developer Portal](https://www.canva.com/developers/apps) → your app
2. **Code upload** → **App source** → **Development URL**
3. Paste the **Development URL (Frontend)** from the terminal
4. Click **Preview** to open Canva with the app

## Step 5: Create an Autofill Template

1. In Canva, create a design (e.g. 1000×1500 for Pinterest)
2. Add a text box and an image frame (keep them ungrouped)
3. Open **Apps** → **Data autofill** → **Custom**
4. Select your **boxncase-pin-autofill** app (or whatever you named it)
5. Connect and load the sample data
6. Map: text element → `headline`, image frame → `image`
7. Click **Publish as Brand Template**
8. Copy the template URL (e.g. `.../EAHAk...`) and set `CANVA_TEMPLATE_ID` in `.env`

## Step 6: Run the Pipeline

Our pipeline will use that template via the Autofill API. The template must have `headline` and `image` fields matching what we send.

---

## Alternative: Use Built-in Data Sources

If your Canva plan includes **Google Sheets** or **CSV** in Data autofill:

1. Upload `canva-data-source.csv` to Google Sheets
2. Connect it in Data autofill
3. Map `headline` and `image` to your elements
4. Publish as Brand Template

Some plans may not expose these templates to the Autofill API; the Data Connector app is the most reliable path.
