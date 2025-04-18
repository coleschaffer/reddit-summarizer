import { NextResponse } from 'next/server';
import snoowrap from 'snoowrap';
// import OpenAI from 'openai'; // Remove OpenAI import
import Groq from 'groq-sdk'; // Import Groq SDK

// --- Remove Unused Interfaces ---
/*
interface RedditComment {
    body: string;
    score: number;
}
interface RedditSubmission {
    id: string;
    title: string;
    selftext?: string;
    permalink: string;
    comments: RedditComment[];
}
*/

// Initialize Reddit client (snoowrap)
const r = new snoowrap({
  userAgent: 'Reddit-Summarizer-App/0.1 by ' + (process.env.REDDIT_USERNAME || 'UnknownUser'),
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY, // Use Groq API key
});

// Constants
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;
const MAX_GOOGLE_RESULTS_TO_CHECK = 10; // Check top 10 Google results
const MAX_REDDIT_POSTS_TO_PROCESS = 5;  // Process top 5 found Reddit posts
const MAX_COMMENTS_PER_POST = 3;
const GROQ_MODEL = 'llama3-70b-8192'; // Groq model for summarization
const IRRELEVANT_SUMMARY_KEYWORDS = [
    'does not provide any information',
    'is not about',
    'no relevant information',
    'unrelated to the question',
    'has nothing to do with',
    'not relevant to the question',
    'irrelevant to the question'
];

// Helper Functions
function extractRedditSubmissionId(url: string): string | null {
    // Regex to find Reddit submission IDs (6-7 alphanumeric chars) from various URL formats
    const match = url.match(/reddit\.com\/r\/[^\/]+\/comments\/([a-z0-9]{6,10})(\/|$)/i);
    return match ? match[1] : null;
}

function isSummaryRelevant(summary: string): boolean {
    const lowerCaseSummary = summary.toLowerCase();
    return !IRRELEVANT_SUMMARY_KEYWORDS.some(keyword => lowerCaseSummary.includes(keyword));
}

function calculateConfidence(relevantSourcesCount: number): number {
    // Base confidence 50%, +10% per source up to 95%
    const score = 50 + (relevantSourcesCount * 10);
    return Math.min(score, 95);
}

export async function POST(request: Request) {
  try {
    const { question } = await request.json();

    if (!question || typeof question !== 'string') {
      return NextResponse.json({ error: 'Invalid question provided' }, { status: 400 });
    }

    console.log(`Received question: ${question}`);

    if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
        console.error("Google API Key or CSE ID missing from environment variables.");
        return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
    }

    // 1. Perform Google Custom Search
    let redditSubmissionIds: string[] = [];
    try {
        const searchQuery = `${question} reddit`; // Append "reddit"
        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(searchQuery)}&num=${MAX_GOOGLE_RESULTS_TO_CHECK}`;
        
        console.log(`Performing Google Custom Search for: "${searchQuery}"`);
        const googleResponse = await fetch(searchUrl);
        const googleData = await googleResponse.json();

        if (!googleResponse.ok) {
            console.error("Google Search API Error:", googleData);
            throw new Error(googleData.error?.message || `Google Search API failed with status ${googleResponse.status}`);
        }

        if (googleData.items && googleData.items.length > 0) {
            const foundIds = new Set<string>();
            for (const item of googleData.items) {
                if (item && item.link && item.link.includes('reddit.com')) {
                    const submissionId = extractRedditSubmissionId(item.link);
                    if (submissionId) {
                        foundIds.add(submissionId);
                        console.log(` -> Found potential Reddit link: ${item.link} (ID: ${submissionId})`);
                    } else {
                         console.log(` -> Found Reddit domain link, but couldn't extract ID: ${item.link}`);
                    }
                }
                 if (foundIds.size >= MAX_REDDIT_POSTS_TO_PROCESS) break; // Stop once we have enough unique IDs
            }
            redditSubmissionIds = Array.from(foundIds);
        }

        console.log(`Found ${redditSubmissionIds.length} unique Reddit submission IDs via Google Search.`);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to perform Google search.';
        console.error("Error during Google Custom Search:", error);
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }

    if (redditSubmissionIds.length === 0) {
        console.log("No relevant Reddit posts found via Google Search.");
        return NextResponse.json({ finalSummary: "Could not find relevant Reddit discussions via Google for this question.", sources: [], confidenceScore: 0 });
    }

    // 2. Fetch Reddit Content & Generate Initial Summaries
    const initialSummaries: { summary: string; source_link: string }[] = [];
    console.log(`Fetching content for ${redditSubmissionIds.length} Reddit posts...`);
    for (const submissionId of redditSubmissionIds) {
      try {
        console.log(` - Fetching submission ${submissionId}...`);
        // Use @ts-expect-error as preferred by ESLint rule
        // @ts-expect-error -- Snoowrap's fetch() return type causes intermittent build errors
        const submission = await r.getSubmission(submissionId).fetch();

        const postLink = `https://reddit.com${submission.permalink || ''}`; // Construct link early

        if (!submission.comments || !Array.isArray(submission.comments) || submission.comments.length === 0) {
          console.log(`   - Comments data missing, not an array, or empty.`);
          continue;
        }

        // Explicitly type sort parameters as any to satisfy noImplicitAny rule
        const topComments = submission.comments
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
          .slice(0, MAX_COMMENTS_PER_POST);

        if (topComments.length === 0) {
          console.log(`   - No top comments found (possibly filtered out low-score/deleted).`);
          continue;
        }

        // Explicitly type map parameter as any to satisfy noImplicitAny rule
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const commentsText = topComments.map((comment: any, index: number) => `${index + 1}. ${comment.body}`).join('\n');
        const summaryPrompt = `Summarize the key advice or information from the following Reddit thread regarding the question "${question}". Focus ONLY on the aspects directly answering the question. If the thread is irrelevant to the question, please state that clearly (e.g., 'This thread is not relevant...').\n\nPost Title: ${submission.title}\nPost Body: ${submission.selftext || 'N/A'}\n\nTop Comments:\n${commentsText}\n\nSummary:`;

        console.log(`   - Generating initial summary using Groq...`);
        const summaryCompletion = await groq.chat.completions.create({
          model: GROQ_MODEL,
          messages: [{ role: 'user', content: summaryPrompt }],
          max_tokens: 200, // Slightly increase tokens for initial summary
          temperature: 0.4,
        });

        const summaryText = summaryCompletion.choices[0]?.message?.content?.trim();

        if (summaryText) {
          initialSummaries.push({
            summary: summaryText,
            source_link: postLink,
          });
          console.log(`   - Initial summary generated for ${submissionId}.`);
        } else {
          console.log(`   - Failed to generate initial summary for ${submissionId}.`);
        }
      } catch (error) {
          // Check if it's a snoowrap error with statusCode
          let statusCode: number | undefined = undefined;
          if (typeof error === 'object' && error !== null && 'statusCode' in error) {
              statusCode = (error as { statusCode: number }).statusCode;
          }

          if (statusCode === 401) {
             console.error("Reddit authentication failed fetching submission. Check credentials.");
             return NextResponse.json({ error: 'Reddit authentication failed.' }, { status: 401 });
           } else {
             const loopErrorMessage = error instanceof Error ? error.message : 'Unknown error processing submission.';
             console.error(` - Error processing submission ${submissionId}:`, loopErrorMessage, error);
           } 
      }
    }

    // 3. Filter Relevant Summaries
    const relevantSummaries = initialSummaries.filter(s => {
        const isRel = isSummaryRelevant(s.summary);
        // Log decision for each summary
        console.log(` - Filtering summary from ${s.source_link}: Relevant = ${isRel}`);
        return isRel;
    });
    console.log(`Found ${relevantSummaries.length} relevant summaries after filtering.`);

    if (relevantSummaries.length === 0) {
        console.log("No relevant summaries to synthesize after filtering Google results.");
        return NextResponse.json({ finalSummary: "Found some Reddit discussions via Google, but couldn't extract direct answers.", sources: [], confidenceScore: 15 });
    }

    // 4. Final Synthesized Summary
    let finalSummaryText = '';
    const relevantSources = relevantSummaries.map(s => s.source_link);
    console.log(`Sources for final summary: ${relevantSources.join(', ')}`); // Log the final sources
    try {
        console.log("Synthesizing final summary using Groq...");
        const combinedContent = relevantSummaries.map((s, i) => `Relevant Summary From Source ${i + 1} (${s.source_link}):\n${s.summary}`).join('\n\n---\n\n');
        // Refined synthesis prompt
        const synthesisPrompt = `Act as a helpful assistant answering a user's question based *only* on information gathered from relevant Reddit discussions found via Google. The user asked: "${question}"

Here are summaries extracted from those discussions:
${combinedContent}

Synthesize these summaries into a single, cohesive, and direct answer to the user's question. Structure the answer logically using markdown (like ## Headers, **bolding**, and bullet points *) for clear readability. 

If multiple apps, tools, or methods are recommended across the summaries, group them logically and briefly describe each, highlighting key features or benefits mentioned in the summaries. 

Focus on providing a helpful and informative response. Do *not* mention the process of summarizing or refer to the source summaries directly in the final output (e.g., avoid phrases like 'Based on the summaries...'). Start the answer directly.

Final Answer (in Markdown):`;

        const finalCompletion = await groq.chat.completions.create({
            model: GROQ_MODEL,
            messages: [{ role: 'user', content: synthesisPrompt }],
            max_tokens: 600, // Increase token limit slightly for potentially more detailed synthesis
            temperature: 0.6,
        });
        finalSummaryText = finalCompletion.choices[0]?.message?.content?.trim() || 'Could not synthesize a final answer.';
        console.log("Final summary generated.");
    } catch (error) {
        const synthesisErrorMessage = error instanceof Error ? error.message : 'Unknown error during synthesis.';
        console.error("Error during final summary synthesis:", synthesisErrorMessage, error);
        finalSummaryText = "Error occurred while synthesizing the final answer.";
    }

    // 5. Calculate Confidence Score
    const confidenceScore = calculateConfidence(relevantSources.length);

    // 6. Return Final Response
    return NextResponse.json({
        finalSummary: finalSummaryText,
        sources: relevantSources,
        confidenceScore: confidenceScore
    });

  } catch (error) {
    console.error('API Route Error:', error);
    let outerErrorMessage = 'Failed to process request.';
    let statusCode = 500;

    if (error instanceof SyntaxError) {
      outerErrorMessage = 'Invalid JSON in request body.';
      statusCode = 400;
    } else {
        // Try to infer status code from Groq/Reddit errors if possible
        if (typeof error === 'object' && error !== null) {
            if ('status' in error && typeof (error as { status: unknown }).status === 'number') statusCode = (error as { status: number }).status;
            else if ('statusCode' in error && typeof (error as { statusCode: unknown }).statusCode === 'number') statusCode = (error as { statusCode: number }).statusCode;
        }
        if (error instanceof Error) outerErrorMessage = error.message;
    }

    return NextResponse.json({ error: outerErrorMessage }, { status: statusCode });
  }
} 