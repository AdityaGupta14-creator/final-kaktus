export const runtime = 'nodejs';

export const ACTIVE_MODELS = [
  {
    name: 'models/gemini-3.5-flash-lite',
    displayName: 'Gemini 3.5 Flash Lite',
    version: '3.5',
    description: 'Fast, efficient model for basic hardware assistance',
  },
  {
    name: 'models/gemini-3.5-flash',
    displayName: 'Gemini 3.5 Flash',
    version: '3.5',
    description: 'High reasoning performance for complex circuit design',
  },
  {
    name: 'models/gemini-3.6-flash',
    displayName: 'Gemini 3.6 Flash',
    version: '3.6',
    description: 'Multimodal schematic, PCB analysis & firmware synthesis',
  },
  {
    name: 'models/gemini-3.7-flash',
    displayName: 'Gemini 3.7 Flash',
    version: '3.7',
    description: 'State of the art hardware verification & electrical design',
  },
  {
    name: 'models/gemini-3.8-flash',
    displayName: 'Gemini 3.8 Flash',
    version: '3.8',
    description: 'Ultimate pro tier with deep engineering logic',
  },
];

export async function GET() {
  return Response.json({ models: ACTIVE_MODELS });
}
