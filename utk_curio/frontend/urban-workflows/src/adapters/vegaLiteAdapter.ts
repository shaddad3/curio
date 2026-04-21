/**
 * VegaLiteAdapter: GrammarAdapter implementation for Vega-Lite visualizations.
 *
 * Wraps the Vega-Lite compile + Vega View creation logic that was previously
 * embedded inside useVega / VegaNode. This adapter can be used standalone or
 * via the grammar adapter registry.
 */

import { GrammarAdapter, registerGrammarAdapter } from '../registry/grammarAdapter';
import { parseDataframe, parseGeoDataframe } from '../utils/parsing';
import { fetchData } from '../services/api';

const vega = require('vega');
const lite = require('vega-lite');

// async function parseInputData(input: any): Promise<any[]> {
//   if (!input || input === '') {
//     throw new Error('Input data must be provided');
//   }

//   const inputType = input.dataType;
//   if (inputType !== 'dataframe' && inputType !== 'geodataframe') {
//     throw new Error(`${inputType} is not a valid input type for Vega-Lite`);
//   }

//   const parserMap: Record<string, (data: any) => any> = {
//     dataframe: parseDataframe,
//     geodataframe: parseGeoDataframe,
//   };

//   // const parser = parserMap[inputType];
//   // if (!parser) return [];

//   // if (input.path) {
//   //   const fetched = await fetchData(input.path);
//   //   return parser(fetched.data);
//   // }
//   // return parser(input.data);
//   const parser = parserMap[inputType];
//   if (!parser) return [];

//   // --- NEW: Detect if the data payload is a Parquet path string ---
//   const isDataPath = typeof input.data === 'string';
//   const pathToFetch = isDataPath ? input.data : input.path;

//   if (pathToFetch) {
//     const fetched = await fetchData(pathToFetch);
//     return parser(fetched.data !== undefined ? fetched.data : fetched);
//   }
  
//   return parser(input.data);
// }
async function parseInputData(input: any): Promise<any[]> {
  if (!input || input === '') {
    throw new Error('Input data must be provided');
  }

  const inputType = input.dataType;
  if (inputType !== 'dataframe' && inputType !== 'geodataframe') {
    throw new Error(`${inputType} is not a valid input type for Vega-Lite`);
  }

  const parserMap: Record<string, (data: any) => any> = {
    dataframe: parseDataframe,
    geodataframe: parseGeoDataframe,
  };

  const isDataPath = typeof input.data === 'string';
  const pathToFetch = isDataPath ? input.data : input.path;

  if (pathToFetch) {
    // Pass 'true' so the Arrow IPC parses directly to an array of row objects
    const fetched = await fetchData(pathToFetch, true);
    
    if (Array.isArray(fetched)) return fetched;

    // Fallback for legacy JSON
    const parser = parserMap[inputType];
    return parser ? parser(fetched.data !== undefined ? fetched.data : fetched) : [];
  }

  // Fallback for legacy inline JSON
  const parser = parserMap[inputType];
  return parser ? parser(input.data) : [];
}

export const vegaLiteAdapter: GrammarAdapter = {
  grammarId: 'vega-lite',

  validate(spec: unknown): boolean {
    try {
      const parsed = typeof spec === 'string' ? JSON.parse(spec) : spec;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed);
    } catch {
      return false;
    }
  },

  async render(
    container: HTMLElement,
    spec: unknown,
    data?: unknown,
  ): Promise<void> {
    const specObj = typeof spec === 'string' ? JSON.parse(spec as string) : { ...spec as any };
    const inputData = data as any;

    const values = await parseInputData(inputData);
    specObj.data = { values, name: 'data' };
    specObj.height = 'container';
    specObj.width = 'container';

    const vegaSpec = lite.compile(specObj).spec;
    const view = new vega.View(vega.parse(vegaSpec))
      .logLevel(vega.Warn)
      .renderer('svg')
      .initialize(container)
      .hover();

    await view.runAsync();
    return view;
  },

  getDefaultSpec(): unknown {
    return {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      mark: 'point',
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
      },
    };
  },
};

registerGrammarAdapter(vegaLiteAdapter);
