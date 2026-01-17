import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import axios from "axios";
import { promises as fs } from "fs";
import { join } from "path";

const generateLongFormScript = async ({
  contextProfile,
  topic,
  duration,
  logger,
}: {
  contextProfile: any;
  topic: string;
  duration: number;
  logger?: IMastraLogger;
}) => {
  logger?.info("🔧 [ScriptGenerator] Starting script generation", { 
    topic,
    duration,
    niche: contextProfile.niche 
  });

  try {
    const prompt = `You are an expert YouTube script writer for "Lift Life" - a fitness brand for overwhelmed but ambitious fathers. Using the audience research below, create a compelling ${duration}-minute long-form video script about "${topic}" that follows the brand's specific style.

AUDIENCE RESEARCH CONTEXT:
Niche: ${contextProfile.niche}
Target Audience: ${contextProfile.targetAudience}
Brand Voice: ${contextProfile.brandVoice}

TOP AUDIENCE KEYWORDS: ${contextProfile.insights.topKeywords?.join(', ') || 'N/A'}

EMOTIONAL HOOKS THAT WORK:
${contextProfile.insights.emotionalHooks?.slice(0, 3).join('\n') || 'No emotional hooks available'}

COMMON AUDIENCE PROBLEMS:
${contextProfile.insights.commonProblems?.slice(0, 3).join('\n') || 'No problems available'}

SUCCESSFUL CONTENT PATTERNS:
${contextProfile.insights.contentPatterns?.slice(0, 3).join('\n') || 'No patterns available'}

AUDIENCE LANGUAGE STYLE:
${contextProfile.insights.audienceLanguage?.slice(0, 5).join('\n') || 'No language samples available'}

MANDATORY SCRIPT STYLE & STRUCTURE:

1. STORY-FIRST COLD OPEN (15-30 seconds):
- Start with 1-2 sentence dad-specific moment that mirrors their pain (time, energy, identity)
- Promise transformation in plain English
- Example: "Saturday morning. Kids want pancakes. You're exhausted before 8 AM. Here's how to change that starting this week."

2. DIRECT, NO-FLUFF COACHING:
- Short sentences only. Concrete steps. Show exactly what to do this week.
- No theory. Pure action.

3. IDENTITY & LEGACY FRAMING:
- Tie every tactic to being a better husband and father
- Use "Stronger fathers. Stronger families." messaging
- Connect physical strength to emotional/spiritual leadership

4. "PROOF IS PROOF" MOMENTS:
- Insert 1 data nugget or micro-case per main section
- Use client texts, screenshots, before→after habits
- Make it concrete and believable

5. "TWO THINGS CAN BE TRUE" REFRAMES:
- Address common objections with this pattern
- Example: "You're busy AND you still need to train. So we make the training fit the busy."

6. ACTION BLOCKS:
- Each main section ends with 60-second checklist viewers can copy immediately
- Make it actionable this week

7. EMPATHETIC BUT FIRM:
- Call out common excuses, then give simplest next step
- No judgment, but no enabling

8. VALUES-AWARE:
- Light references to faith, discipline, stewardship, service
- Not preachy, just grounded in purpose

9. ANTI-PERFECTION MESSAGING:
- "Done beats ideal"
- "90 minutes a week done right beats random 5 hours"
- Progress over perfection

CTA REQUIREMENTS (Choose ONE primary):

OPTION A - Email List CTA:
"Want this to stick this week? Grab my Busy Dad 90-Minute Week Plan. It's a one-page template with the exact workouts, breakfast template, and a 5-minute night routine. First link. Print it. Use it tonight."

OPTION B - Skool Community CTA:
"Don't do this alone. Join the Fit Father Formula on Skool. Post your first 'win' tonight and I'll send you the 7-day jumpstart checklist inside the group. First link."

MANDATORY BRAND PHRASES TO INCLUDE:
- "Lift Life!"
- "Proof is proof"  
- "Strong Fathers. Strong Families."
- "Two things can be true"
- At least one anti-perfection line

FORMAT YOUR RESPONSE AS:
{
  "title": "Dad-focused title with urgency/transformation",
  "hook": "Story-first cold open (1-2 dad-specific sentences + promise)",
  "introduction": "Brief introduction that sets up the identity/legacy stakes",
  "mainBeats": [
    {
      "beat": 1,
      "title": "Beat title",
      "script": "Script with proof moment and action block",
      "brollSuggestion": "B-roll showing real dads/families",
      "duration": "2-3 minutes"
    }
  ],
  "callToAction": "Use exact CTA language from options above",
  "thumbnailIdea": "Dad-focused thumbnail concept",
  "seoKeywords": ["busy dad", "father fitness", "time efficient"],
  "estimatedEngagement": "prediction based on research"
}

This script must sound like a trusted coach who's in the trenches with these dads, not on a pedestal above them.`;

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 3000,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );

    const scriptText = response.data.content[0].text;
    logger?.info("📝 [ScriptGenerator] Generated script", { 
      scriptLength: scriptText.length 
    });

    // Try to parse as JSON, fallback to structured text
    let scriptData;
    try {
      scriptData = JSON.parse(scriptText);
    } catch {
      // If not valid JSON, create structured script from text
      scriptData = {
        title: extractSection(scriptText, 'title') || `${topic} - The Ultimate Guide`,
        hook: extractSection(scriptText, 'hook') || scriptText.substring(0, 200),
        introduction: extractSection(scriptText, 'introduction') || 'Introduction not parsed',
        mainBeats: parseBeats(scriptText) || [],
        callToAction: extractSection(scriptText, 'callToAction') || extractSection(scriptText, 'cta') || 'Subscribe for more!',
        thumbnailIdea: extractSection(scriptText, 'thumbnailIdea') || extractSection(scriptText, 'thumbnail') || 'Eye-catching thumbnail',
        seoKeywords: contextProfile.insights.topKeywords?.slice(0, 5) || [],
        estimatedEngagement: 'Based on audience research patterns',
        rawScript: scriptText,
        generatedAt: new Date().toISOString()
      };
    }

    // Enhance with metadata
    scriptData.metadata = {
      topic,
      duration,
      niche: contextProfile.niche,
      targetAudience: contextProfile.targetAudience,
      brandVoice: contextProfile.brandVoice,
      basedOnVideos: contextProfile.videos.total,
      generatedAt: new Date().toISOString(),
      estimatedWordCount: (scriptText.match(/\w+/g) || []).length
    };

    return scriptData;

  } catch (error) {
    logger?.error("❌ [ScriptGenerator] Failed to generate script", { 
      topic,
      error: String(error) 
    });
    throw error;
  }
};

// Helper functions to parse script sections
function extractSection(text: string, section: string): string | null {
  const patterns = [
    new RegExp(`"${section}":\\s*"([^"]*)"`, 'i'),
    new RegExp(`${section}:\\s*"([^"]*)"`, 'i'),
    new RegExp(`${section}:\\s*([^\n]*)\n`, 'i')
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function parseBeats(text: string): any[] {
  const beats = [];
  const beatPattern = /"beat":\s*(\d+),\s*"title":\s*"([^"]*)",\s*"script":\s*"([^"]*)",\s*"brollSuggestion":\s*"([^"]*)",\s*"duration":\s*"([^"]*)"/g;
  
  let match;
  while ((match = beatPattern.exec(text)) !== null) {
    beats.push({
      beat: parseInt(match[1]),
      title: match[2],
      script: match[3],
      brollSuggestion: match[4],
      duration: match[5]
    });
  }
  
  // If no beats found, create generic ones from content
  if (beats.length === 0) {
    const paragraphs = text.split('\n\n').filter(p => p.trim().length > 50);
    paragraphs.slice(0, 3).forEach((para, index) => {
      beats.push({
        beat: index + 1,
        title: `Main Point ${index + 1}`,
        script: para.substring(0, 500),
        brollSuggestion: "Relevant visuals",
        duration: "2-3 minutes"
      });
    });
  }
  
  return beats;
}

export const scriptGeneratorTool = createTool({
  id: "script-generator-tool",
  description: "Generates long-form YouTube scripts with beats, B-roll notes, and CTAs based on audience research",
  inputSchema: z.object({
    contextProfile: z.object({
      niche: z.string(),
      targetAudience: z.string(),
      brandVoice: z.string(),
      createdAt: z.string(),
      videos: z.object({
        total: z.number(),
        channels: z.array(z.string()),
        totalViews: z.number()
      }),
      insights: z.object({
        topKeywords: z.array(z.string()),
        emotionalHooks: z.array(z.string()),
        commonProblems: z.array(z.string()),
        contentPatterns: z.array(z.string()),
        audienceLanguage: z.array(z.string())
      })
    }).describe("Context profile with audience insights"),
    topic: z.string().default("Content Creation Strategies").describe("The main topic for the script"),
    duration: z.number().default(10).describe("Target video duration in minutes"),
    scriptStyle: z.string().default("educational").describe("Style: educational, entertaining, or inspiring"),
  }),
  outputSchema: z.object({
    title: z.string(),
    hook: z.string(),
    introduction: z.string(),
    mainBeats: z.array(z.object({
      beat: z.number(),
      title: z.string(),
      script: z.string(),
      brollSuggestion: z.string(),
      duration: z.string()
    })),
    callToAction: z.string(),
    thumbnailIdea: z.string(),
    seoKeywords: z.array(z.string()),
    estimatedEngagement: z.string(),
    metadata: z.object({
      topic: z.string(),
      duration: z.number(),
      niche: z.string(),
      targetAudience: z.string(),
      brandVoice: z.string(),
      basedOnVideos: z.number(),
      generatedAt: z.string(),
      estimatedWordCount: z.number()
    }).optional(),
    rawScript: z.string().optional()
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    const { contextProfile, topic, duration, scriptStyle } = context;
    
    logger?.info('🔧 [ScriptGenerator] Starting execution', { 
      topic,
      duration,
      scriptStyle,
      niche: contextProfile.niche 
    });
    
    const script = await generateLongFormScript({
      contextProfile,
      topic,
      duration,
      logger
    });
    
    // Save script to file for reference
    try {
      const dataDir = join(process.cwd(), 'data');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const scriptFile = join(dataDir, `script_${topic.replace(/\s+/g, '_')}_${timestamp}.json`);
      
      await fs.writeFile(scriptFile, JSON.stringify(script, null, 2), 'utf-8');
      logger?.info("📝 [ScriptGenerator] Saved script to file", { file: scriptFile });
      
      script.savedToFile = scriptFile;
    } catch (error) {
      logger?.warn("⚠️ [ScriptGenerator] Could not save script to file", { error: String(error) });
    }
    
    logger?.info('✅ [ScriptGenerator] Completed script generation', { 
      title: script.title,
      beatsCount: script.mainBeats?.length || 0,
      wordCount: script.metadata?.estimatedWordCount || 0
    });
    
    return script;
  },
});