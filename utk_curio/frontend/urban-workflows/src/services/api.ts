// export async function fetchData(fileName: string, vega: boolean = false) {
//     try {
//         // const url = `${process.env.BACKEND_URL}/get?fileName=${encodeURIComponent(fileName)}${vega ? '&vega=true' : ''}`;
//         const url = `${process.env.BACKEND_URL}/get?fileName=${encodeURIComponent(fileName)}`;
//         console.log(`Fetching ${url}`);
        
//         const response = await fetch(url, {
//             headers: {
//                 'Content-Type': 'application/json',
//             },
//         });

//         if (!response.ok) {
//             throw new Error(`Failed to fetch file ${url}: ${response.statusText}`);
//         }

//         const jsonData = await response.json();

//         if(vega)
//             return transformToVega(jsonData);

//         console.log(`Fetched data`, jsonData);

//         return jsonData;
//     } catch (error: unknown) {
//         console.error("Error:", error instanceof Error ? error.message : String(error));
//         throw error;
//     }
// }

import { tableFromIPC } from 'apache-arrow';

export async function fetchData(fileName: string, vega: boolean = false) {
    try {
        // We request the file without the vega URL param because 
        // the backend now streams the raw Arrow IPC format directly.
        const url = `${process.env.BACKEND_URL}/get?fileName=${encodeURIComponent(fileName)}`;
        console.log(`Fetching ${url}`);
        
        const response = await fetch(url, {
            headers: {
                // Change Content-Type (which is for sending data) 
                // to Accept (which tells the server what we want to receive)
                'Accept': 'application/vnd.apache.arrow.stream, application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch file ${url}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type');

        // 1. ARROW BYTE-STREAM PATH (High Performance)
        if (contentType && contentType.includes('application/vnd.apache.arrow.stream')) {
            const arrayBuffer = await response.arrayBuffer();
            const arrowTable = tableFromIPC(arrayBuffer);

            // if (vega) {
            //     // Vega-Lite expects row-oriented data (an array of objects).
            //     // Arrow tables natively map to this structure incredibly fast.
            //     const vegaData = arrowTable.toArray().map(row => row?.toJSON());
            //     return vegaData;
            // }
            if (vega) {
                // Vega-Lite expects row-oriented data
                const vegaData = arrowTable.toArray().map(row => {
                    const obj = row?.toJSON();
                    // FIX: Vega-Lite crashes on BigInts. Cast them to standard Numbers.
                    for (const key in obj) {
                        if (typeof obj[key] === 'bigint') {
                            obj[key] = Number(obj[key]);
                        }
                    }
                    return obj;
                });
                return vegaData;
            }

            // // Existing Curio nodes (like the Table) expect a column-oriented dictionary.
            // // We extract each column from the Arrow Table to mimic the legacy JSON shape.
            // const columnsData: Record<string, any[]> = {};
            // arrowTable.schema.fields.forEach(field => {
            //     const column = arrowTable.getChild(field.name);
            //     // Convert the Arrow vector into a standard JavaScript Array
            //     columnsData[field.name] = column ? Array.from(column.toArray()) : [];
            // });
            // Existing Curio nodes expect a column-oriented dictionary.
            const columnsData: Record<string, any[]> = {};
            arrowTable.schema.fields.forEach(field => {
                const column = arrowTable.getChild(field.name);
                if (column) {
                    const arr = Array.from(column.toArray());
                    // FIX: Cast BigInts to standard Numbers for frontend Data Pools
                    columnsData[field.name] = arr.map(v => typeof v === 'bigint' ? Number(v) : v);
                } else {
                    columnsData[field.name] = [];
                }
            });

            const reconstructedJson = {
                data: columnsData,
                dataType: "dataframe"
            };

            console.log(`Fetched Arrow stream`, reconstructedJson);
            return reconstructedJson;
        }

        // 2. LEGACY JSON PATH (Metadata, Configs, Old Files)
        const jsonData = await response.json();

        if (vega) {
            return transformToVega(jsonData);
        }

        console.log(`Fetched JSON data`, jsonData);
        return jsonData;

    } catch (error: unknown) {
        console.error("Error:", error instanceof Error ? error.message : String(error));
        throw error;
    }
}

/**
 * Fetches a preview version of the data (first 100 rows) for display purposes.
 * This is more efficient than fetching the entire dataset when only displaying data.
 * 
 * @param fileName - The name of the file to fetch
 * @returns The preview data with metadata about row counts
 */
export async function fetchPreviewData(fileName: string) {
    try {
        // Use the correct backend URL
        const backendUrl = process.env.BACKEND_URL || 'http://localhost:5002';
        const url = `${backendUrl}/get-preview?fileName=${encodeURIComponent(fileName)}`;
        console.log(`[fetchPreviewData] Fetching preview from ${url}`);
        
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch preview ${url}: ${response.statusText}`);
        }

        const jsonData = await response.json();
        console.log(`[fetchPreviewData] Fetched preview data:`, jsonData);

        return jsonData;
    } catch (error: unknown) {
        console.error("[fetchPreviewData] Error:", error instanceof Error ? error.message : String(error));
        throw error;
    }
}

/**
 * Transforms a pandas-style JSON (column-based) to Vega-Lite-ready JSON (row-based).
 *
 * @param data - The original pandas-style JSON data.
 * @returns The transformed Vega-Lite-ready JSON data.
 */
export function transformToVega(
    data: { data?: Record<string, any[]> }
): Record<string, any>[] | typeof data {
    if (data.data && typeof data.data === "object" && !Array.isArray(data.data)) {
        const columns = Object.keys(data.data);
        const numRows = data.data[columns[0]]?.length || 0;

        const values: Record<string, any>[] = [];

        for (let i = 0; i < numRows; i++) {
            const row: Record<string, any> = {};
            for (const col of columns) {
                row[col] = data.data[col][i];
            }
            values.push(row);
        }

        return values;
    }

    return data;
}