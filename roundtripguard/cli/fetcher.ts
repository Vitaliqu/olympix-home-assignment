import axios from "axios";
import * as fs from "fs";

export interface SourceFile {
  name: string;
  content: string;
}

/** Fetch verified Solidity source from Etherscan. Returns array of source files. */
export async function fetchSource(
  contractAddress: string,
  apiKey: string
): Promise<SourceFile[]> {
  const url = `https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${apiKey}`;
  const res = await axios.get(url);

  if (res.data.status !== "1") {
    throw new Error(`Etherscan error: ${res.data.message}`);
  }

  const result = res.data.result[0];
  if (!result.SourceCode) throw new Error("Contract source not verified on Etherscan");

  // Handle both single-file and multi-file (JSON) responses
  if (result.SourceCode.startsWith("{")) {
    const raw = result.SourceCode.startsWith("{{")
      ? result.SourceCode.slice(1, -1)
      : result.SourceCode;
    const parsed = JSON.parse(raw);
    return Object.entries(parsed.sources ?? parsed).map(([name, src]: [string, any]) => ({
      name,
      content: src.content,
    }));
  }

  return [{ name: `${contractAddress}.sol`, content: result.SourceCode }];
}

/** Load Solidity source from local file (for offline testing). */
export function loadLocalSource(filePath: string): SourceFile[] {
  return [{ name: filePath, content: fs.readFileSync(filePath, "utf-8") }];
}
