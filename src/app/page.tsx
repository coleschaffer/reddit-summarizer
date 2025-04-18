'use client' // Add this directive for handling client-side interactions

import { useState } from 'react';
import ReactMarkdown from 'react-markdown'; // Import react-markdown

interface ResultData {
  finalSummary?: string;
  sources?: string[];
  confidenceScore?: number;
  error?: string;
}

export default function Home() {
  const [question, setQuestion] = useState('');
  const [results, setResults] = useState<ResultData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setResults(null);

    try {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question }),
      });

      const data: ResultData = await response.json();

      if (!response.ok) {
        // Use error message from API if available, otherwise use status text
        throw new Error(data.error || response.statusText || `HTTP error! status: ${response.status}`);
      }

      setResults(data);
    } catch (error) {
      console.error("Failed to fetch summary:", error);
      // Ensure error.message exists or provide a fallback string
      const errorMessage = error instanceof Error ? error.message : 'Failed to get summary. Check console for details.';
      setResults({ error: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-start p-12 bg-gray-50">
      <h1 className="text-4xl font-bold mb-8 text-gray-800">What do you want help with?</h1>
      <form onSubmit={handleSubmit} className="w-full max-w-lg mb-8">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything..."
          required
          className="w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg text-gray-700"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-md shadow transition duration-150 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Getting answers...' : 'Submit'}
        </button>
      </form>

      {/* Results Display Area */}
      {isLoading && (
        <div className="mt-8 text-center text-gray-600 animate-pulse">Loading...</div>
      )}
      
      {results && !isLoading && (
        <div className="w-full max-w-4xl mt-8 bg-white p-8 rounded-lg shadow-lg border border-gray-200">
          {results.error ? (
            <p className="text-red-600 font-medium">Error: {results.error}</p>
          ) : results.finalSummary ? (
            <>
              {/* Confidence Score - Add margin bottom */}
              {typeof results.confidenceScore === 'number' && (
                <div className="mb-8 text-right"> {/* Increased margin */}
                  <span className="inline-block bg-blue-100 text-blue-800 text-sm font-semibold px-4 py-1.5 rounded-full"> {/* Slightly larger padding */}
                    Confidence: {results.confidenceScore}%
                  </span>
                </div>
              )}

              {/* Final Summary - Ensure text color is applied correctly, add spacing */}
              <div className="prose prose-lg text-gray-800 max-w-none mb-8 space-y-4"> {/* Explicit text color, added bottom margin and space-y for paragraph spacing */}
                 <ReactMarkdown>{results.finalSummary}</ReactMarkdown>
              </div>

              {/* Sources Section - Improve spacing and link appearance */}
              {results.sources && results.sources.length > 0 && (
                <div className="mt-8 pt-6 border-t border-gray-300"> {/* Increased top margin/padding and border thickness */}
                  <strong className="block mb-3 text-base font-semibold text-blue-800">Sources:</strong> {/* Bolder, larger, more margin */}
                  <ol className="list-decimal list-inside space-y-2"> {/* Increased spacing between items */}
                    {results.sources.map((link, index) => (
                      <li key={index} className="text-sm text-gray-600"> {/* Slightly muted color for links */}
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 hover:underline break-all" // Allow long URLs to break
                          title={link}
                        >
                          {/* Optionally shorten displayed link if needed, but full URL is clear */}
                           {link}
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          ) : (
            <p className="text-gray-600 text-center py-4">No relevant information found.</p> // Centered fallback text
          )}
        </div>
      )}
    </main>
  );
}
