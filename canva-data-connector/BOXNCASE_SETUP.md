# BoxNCase Pin Data Connector – Quick Setup

A Canva Data Connector app that exposes **headline** and **image** fields for Pinterest pin templates. Use this to create autofill-capable Brand Templates that work with the BoxNCase pipeline's Autofill API.

## Quick setup

1. **Create a Canva app** at [Developer Portal](https://www.canva.com/developers/apps)
2. Enable the **Data Connector** intent
3. Run `npm install` then `npm start`
4. In Developer Portal → **App source** → **Development URL** → enter `http://localhost:8080`
5. Click **Preview** to open Canva with the app

## Using it

1. In Canva, create a design (e.g. 1000×1500 for Pinterest)
2. Add a text box and image frame (keep them ungrouped)
3. **Apps** → **Data autofill** → **Custom** → select **Pinterest Pin Data**
4. Click **Load Pin Data**
5. Map: text → `headline`, image → `image`
6. **Publish as Brand Template**
7. Copy the template ID from the URL and set `CANVA_TEMPLATE_ID` in your pipeline's `.env`

**Note:** OAuth setup (in the main README) is optional for this app – the Pin Data source uses static sample data and does not call external APIs.
