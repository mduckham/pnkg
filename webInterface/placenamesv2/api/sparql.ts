/** Vercel serverless function proxying SPARQL queries to Fuseki — avoids CORS since the browser only ever talks to the same Vercel domain. */

const FUSEKI_ENDPOINT = "https://placenames.org/fuseki/geo20260709";

export default async function handler(
  req: { method?: string; query?: Record<string, string | string[]>; url?: string },
  res: {
    status: (code: number) => { json: (data: unknown) => void; end: (body: string) => void };
    setHeader: (key: string, value: string) => void;
  }
) {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    return res.status(204).end("");
  }

  // Extract query parameter
  const query = req.query?.query as string | undefined;

  if (!query) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(400).json({ error: "Missing ?query= parameter" });
  }

  try {
    const fusekiUrl = `${FUSEKI_ENDPOINT}?query=${encodeURIComponent(query)}`;

    const response = await fetch(fusekiUrl, {
      method: "GET",
      headers: {
        Accept: "application/sparql-results+json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Fuseki error:", response.status, text);
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res
        .status(response.status)
        .json({ error: `Fuseki returned ${response.status}`, details: text });
    }

    const data = await response.json();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/sparql-results+json");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

    return res.status(200).json(data);
  } catch (error) {
    console.error("SPARQL proxy error:", error);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(502).json({ error: "Failed to reach SPARQL endpoint" });
  }
}
