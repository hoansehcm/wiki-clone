'use client';

import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Menu, 
  X, 
  BookOpen, 
  Save, 
  Edit3, 
  Plus, 
  History, 
  User as UserIcon,
  LogOut,
  ChevronRight,
  ExternalLink,
  Github,
  Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  orderBy
} from 'firebase/firestore';
import { auth, db } from '@/firebase';

// --- Types ---
interface WikiArticle {
  id?: string;
  title: string;
  content: string;
  authorId: string;
  createdAt: any;
  updatedAt: any;
  isPublic: boolean;
  sourceUrl?: string;
}

interface WikipediaSearchResult {
  title: string;
  snippet: string;
  pageid: number;
}

// --- Wikipedia API Service ---
const WikipediaService = {
  async search(term: string): Promise<WikipediaSearchResult[]> {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&format=json&origin=*`;
    const response = await fetch(url);
    const data = await response.json();
    return data.query.search;
  },

  async getArticle(title: string): Promise<{ title: string; content: string; url: string }> {
    const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|info&exintro=0&explaintext=0&titles=${encodeURIComponent(title)}&inprop=url&format=json&origin=*`;
    const response = await fetch(url);
    const data = await response.json();
    const pages = data.query.pages;
    const pageId = Object.keys(pages)[0];
    const page = pages[pageId];
    
    // Wikipedia API returns HTML in extracts if explaintext is 0, but explaintext=1 gives plain text.
    // We'll use explaintext=0 to get some structure if possible, but for markdown we might prefer text.
    // Let's try to get a better version.
    const contentUrl = `https://en.wikipedia.org/api/rest_v1/page/mobile-sections/${encodeURIComponent(title)}`;
    const contentResponse = await fetch(contentUrl);
    const contentData = await contentResponse.json();
    
    // Simple conversion of mobile sections to markdown-ish
    let fullContent = "";
    if (contentData.lead && contentData.lead.sections) {
      contentData.lead.sections.forEach((sec: any) => {
        if (sec.text) fullContent += sec.text + "\n\n";
      });
    }
    if (contentData.remaining && contentData.remaining.sections) {
      contentData.remaining.sections.forEach((sec: any) => {
        if (sec.line) fullContent += `## ${sec.line}\n\n`;
        if (sec.text) fullContent += sec.text + "\n\n";
      });
    }

    return {
      title: page.title,
      content: fullContent || page.extract || "No content found.",
      url: page.fullurl
    };
  }
};

// --- Components ---

const SidebarItem = ({ icon: Icon, label, active, onClick }: { icon: any, label: string, active?: boolean, onClick: () => void }) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-4 py-2 text-sm font-medium transition-colors rounded-md ${
      active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
    }`}
  >
    <Icon size={18} />
    <span>{label}</span>
  </button>
);

export default function WikiClone() {
  const [user, setUser] = useState<User | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WikipediaSearchResult[]>([]);
  const [currentArticle, setCurrentArticle] = useState<{ title: string; content: string; url?: string; id?: string } | null>(null);
  const [savedArticles, setSavedArticles] = useState<WikiArticle[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [view, setView] = useState<'home' | 'article' | 'saved' | 'edit'>('home');
  const [isLoading, setIsLoading] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        // Fetch saved articles
        const q = query(
          collection(db, 'articles'), 
          where('authorId', '==', u.uid),
          orderBy('updatedAt', 'desc')
        );
        return onSnapshot(q, (snapshot) => {
          const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WikiArticle));
          setSavedArticles(docs);
        });
      } else {
        setSavedArticles([]);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsLoading(true);
    try {
      const results = await WikipediaService.search(searchQuery);
      setSearchResults(results);
      setView('home');
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadArticle = async (title: string) => {
    setIsLoading(true);
    try {
      const article = await WikipediaService.getArticle(title);
      setCurrentArticle(article);
      setView('article');
    } catch (error) {
      console.error("Article load error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveArticle = async () => {
    if (!user || !currentArticle) return;
    try {
      const articleData: WikiArticle = {
        title: currentArticle.title,
        content: currentArticle.content,
        authorId: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        isPublic: true,
        sourceUrl: currentArticle.url
      };
      await addDoc(collection(db, 'articles'), articleData);
      alert("Article saved to your wiki!");
    } catch (error) {
      console.error("Save error:", error);
    }
  };

  const startEdit = (article?: WikiArticle) => {
    if (article) {
      setEditTitle(article.title);
      setEditContent(article.content);
      setCurrentArticle({ title: article.title, content: article.content, id: article.id });
    } else {
      setEditTitle('');
      setEditContent('');
      setCurrentArticle(null);
    }
    setView('edit');
  };

  const handleSaveEdit = async () => {
    if (!user) return;
    try {
      const articleData = {
        title: editTitle,
        content: editContent,
        authorId: user.uid,
        updatedAt: serverTimestamp(),
        isPublic: true,
      };

      if (currentArticle?.id) {
        await setDoc(doc(db, 'articles', currentArticle.id), articleData, { merge: true });
      } else {
        await addDoc(collection(db, 'articles'), {
          ...articleData,
          createdAt: serverTimestamp()
        });
      }
      setView('saved');
    } catch (error) {
      console.error("Edit save error:", error);
    }
  };

  const login = () => signInWithPopup(auth, new GoogleAuthProvider());
  const logout = () => signOut(auth);

  return (
    <div className="flex h-screen bg-white text-gray-900 font-sans overflow-hidden">
      {/* Sidebar */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.aside 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="border-r border-gray-200 bg-gray-50 flex-shrink-0 flex flex-col"
          >
            <div className="p-6 flex items-center gap-2 border-bottom border-gray-200">
              <div className="w-10 h-10 bg-white border border-gray-300 rounded flex items-center justify-center shadow-sm">
                <span className="text-2xl font-serif font-bold">W</span>
              </div>
              <div>
                <h1 className="text-xl font-serif font-bold tracking-tight">WikiClone</h1>
                <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">The Free Encyclopedia</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
              <SidebarItem icon={Globe} label="Main page" active={view === 'home'} onClick={() => setView('home')} />
              <SidebarItem icon={BookOpen} label="Contents" onClick={() => {}} />
              <SidebarItem icon={Plus} label="Create new" onClick={() => startEdit()} />
              
              <div className="pt-4 pb-2 px-4">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Personal Wiki</p>
              </div>
              <SidebarItem icon={History} label="Saved articles" active={view === 'saved'} onClick={() => setView('saved')} />
              
              {savedArticles.map(art => (
                <button 
                  key={art.id}
                  onClick={() => {
                    setCurrentArticle({ title: art.title, content: art.content, id: art.id });
                    setView('article');
                  }}
                  className="w-full text-left px-4 py-1.5 text-xs text-gray-600 hover:text-blue-600 hover:underline truncate"
                >
                  {art.title}
                </button>
              ))}
            </div>

            <div className="p-4 border-t border-gray-200">
              {user ? (
                <div className="flex items-center gap-3">
                  <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-gray-300" alt="" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate">{user.displayName}</p>
                    <button onClick={logout} className="text-[10px] text-gray-500 hover:text-red-600 flex items-center gap-1">
                      <LogOut size={10} /> Logout
                    </button>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={login}
                  className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium bg-white border border-gray-300 rounded-md hover:bg-gray-50 shadow-sm"
                >
                  <UserIcon size={16} /> Login with Google
                </button>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-white relative">
        {/* Header */}
        <header className="h-16 border-b border-gray-200 flex items-center px-6 gap-4 sticky top-0 bg-white z-10">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-gray-100 rounded-md text-gray-500">
            {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          <form onSubmit={handleSearch} className="flex-1 max-w-2xl relative group">
            <input 
              type="text" 
              placeholder="Search WikiClone"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-100 border border-transparent focus:bg-white focus:border-blue-500 rounded-md text-sm outline-none transition-all"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500" size={16} />
          </form>

          <div className="flex items-center gap-2">
            <button className="text-sm font-medium text-blue-600 hover:underline px-2">Read</button>
            <button className="text-sm font-medium text-gray-500 hover:text-gray-900 px-2" onClick={() => view === 'article' && startEdit()}>Edit</button>
            <button className="text-sm font-medium text-gray-500 hover:text-gray-900 px-2">View history</button>
          </div>
        </header>

        {/* View Area */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-8 py-12">
            {isLoading && (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            )}

            {!isLoading && view === 'home' && (
              <div className="space-y-12">
                <div className="border-b border-gray-200 pb-8">
                  <h2 className="text-3xl font-serif font-bold mb-2">Welcome to WikiClone,</h2>
                  <p className="text-gray-600">the free encyclopedia that anyone can edit.</p>
                  <p className="text-sm text-gray-500 mt-4">6,942,069 articles in English</p>
                </div>

                {searchResults.length > 0 ? (
                  <div className="space-y-6">
                    <h3 className="text-xl font-serif font-bold border-b border-gray-200 pb-2">Search Results</h3>
                    {searchResults.map(result => (
                      <div key={result.pageid} className="group">
                        <button 
                          onClick={() => loadArticle(result.title)}
                          className="text-xl text-blue-600 hover:underline font-serif text-left block w-full"
                        >
                          {result.title}
                        </button>
                        <div 
                          className="text-sm text-gray-600 mt-1 line-clamp-2"
                          dangerouslySetInnerHTML={{ __html: result.snippet + '...' }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="p-6 bg-blue-50 border border-blue-100 rounded-lg">
                      <h3 className="font-bold text-blue-800 mb-2 flex items-center gap-2">
                        <Globe size={18} /> From today&apos;s featured article
                      </h3>
                      <p className="text-sm text-gray-700 leading-relaxed">
                        The 1924 FA Cup final was an association football match between Newcastle United and Aston Villa on 26 April 1924 at Wembley Stadium in London.
                      </p>
                      <button onClick={() => loadArticle('1924 FA Cup Final')} className="text-xs text-blue-600 font-bold mt-4 hover:underline">Read more...</button>
                    </div>
                    <div className="p-6 bg-gray-50 border border-gray-200 rounded-lg">
                      <h3 className="font-bold text-gray-800 mb-2 flex items-center gap-2">
                        <History size={18} /> Did you know ...
                      </h3>
                      <ul className="text-sm text-gray-700 space-y-2 list-disc pl-4">
                        <li>... that the WikiClone was built by an AI?</li>
                        <li>... that you can save articles to your personal wiki?</li>
                        <li>... that markdown is supported in the editor?</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!isLoading && view === 'article' && currentArticle && (
              <article className="prose prose-slate max-w-none">
                <div className="flex items-start justify-between border-b border-gray-200 pb-4 mb-8">
                  <div>
                    <h1 className="text-4xl font-serif font-bold m-0">{currentArticle.title}</h1>
                    <p className="text-xs text-gray-500 mt-2">From WikiClone, the free encyclopedia</p>
                  </div>
                  <div className="flex gap-2">
                    {user && (
                      <button 
                        onClick={saveArticle}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold bg-white border border-gray-300 rounded hover:bg-gray-50 shadow-sm"
                      >
                        <Save size={14} /> Save to Wiki
                      </button>
                    )}
                    {currentArticle.url && (
                      <a 
                        href={currentArticle.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold bg-white border border-gray-300 rounded hover:bg-gray-50 shadow-sm"
                      >
                        <ExternalLink size={14} /> Wikipedia
                      </a>
                    )}
                  </div>
                </div>
                
                <div className="wiki-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {currentArticle.content}
                  </ReactMarkdown>
                </div>
              </article>
            )}

            {!isLoading && view === 'saved' && (
              <div className="space-y-8">
                <div className="flex items-center justify-between border-b border-gray-200 pb-4">
                  <h2 className="text-3xl font-serif font-bold">Your Personal Wiki</h2>
                  <button 
                    onClick={() => startEdit()}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    <Plus size={18} /> New Article
                  </button>
                </div>

                {savedArticles.length === 0 ? (
                  <div className="text-center py-20 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                    <BookOpen size={48} className="mx-auto text-gray-300 mb-4" />
                    <p className="text-gray-500">You haven&apos;t saved any articles yet.</p>
                    <button onClick={() => setView('home')} className="text-blue-600 font-bold mt-2 hover:underline">Search Wikipedia to get started</button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {savedArticles.map(art => (
                      <div key={art.id} className="p-6 border border-gray-200 rounded-lg hover:border-blue-300 transition-colors group relative">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="text-xl font-serif font-bold text-blue-600 group-hover:underline cursor-pointer" onClick={() => {
                              setCurrentArticle({ title: art.title, content: art.content, id: art.id });
                              setView('article');
                            }}>
                              {art.title}
                            </h3>
                            <p className="text-xs text-gray-400 mt-1">Last updated: {art.updatedAt?.toDate().toLocaleDateString()}</p>
                          </div>
                          <button 
                            onClick={() => startEdit(art)}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                          >
                            <Edit3 size={18} />
                          </button>
                        </div>
                        <p className="text-sm text-gray-600 mt-3 line-clamp-3 leading-relaxed">
                          {art.content.substring(0, 300)}...
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!isLoading && view === 'edit' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-gray-200 pb-4">
                  <h2 className="text-3xl font-serif font-bold">{currentArticle?.id ? 'Edit Article' : 'Create New Article'}</h2>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setView('saved')}
                      className="px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-md"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleSaveEdit}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm"
                    >
                      Save Changes
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Title</label>
                    <input 
                      type="text" 
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Article Title"
                      className="w-full px-4 py-3 text-2xl font-serif border border-gray-200 rounded-md focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Content (Markdown)</label>
                    <textarea 
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      placeholder="Write your article content here using markdown..."
                      rows={20}
                      className="w-full px-4 py-4 font-mono text-sm border border-gray-200 rounded-md focus:border-blue-500 outline-none resize-none"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="bg-gray-50 border-t border-gray-200 py-12 px-8">
          <div className="max-w-4xl mx-auto flex flex-col md:flex-row justify-between gap-8">
            <div className="space-y-4 max-w-sm">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-white border border-gray-300 rounded flex items-center justify-center">
                  <span className="text-sm font-serif font-bold">W</span>
                </div>
                <span className="font-serif font-bold">WikiClone</span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                Text is available under the Creative Commons Attribution-ShareAlike License; additional terms may apply. By using this site, you agree to the Terms of Use and Privacy Policy.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-12">
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">Navigation</h4>
                <ul className="text-xs text-blue-600 space-y-1">
                  <li><button onClick={() => setView('home')} className="hover:underline">Main page</button></li>
                  <li><button className="hover:underline">Recent changes</button></li>
                  <li><button className="hover:underline">Random article</button></li>
                  <li><button className="hover:underline">About WikiClone</button></li>
                </ul>
              </div>
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">Contribute</h4>
                <ul className="text-xs text-blue-600 space-y-1">
                  <li><button className="hover:underline">Help</button></li>
                  <li><button className="hover:underline">Community portal</button></li>
                  <li><button className="hover:underline">Upload file</button></li>
                </ul>
              </div>
            </div>
          </div>
          <div className="max-w-4xl mx-auto mt-12 pt-8 border-t border-gray-200 flex items-center justify-between">
            <p className="text-[10px] text-gray-400">© 2026 WikiClone Foundation. All rights reserved.</p>
            <div className="flex gap-4">
              <Github size={14} className="text-gray-400 hover:text-gray-900 cursor-pointer" />
              <Globe size={14} className="text-gray-400 hover:text-gray-900 cursor-pointer" />
            </div>
          </div>
        </footer>
      </main>

      <style jsx global>{`
        .wiki-content h1 { font-family: serif; font-weight: bold; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.5rem; margin-top: 2rem; }
        .wiki-content h2 { font-family: serif; font-weight: bold; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.5rem; margin-top: 2rem; }
        .wiki-content h3 { font-family: serif; font-weight: bold; margin-top: 1.5rem; }
        .wiki-content p { margin-top: 1rem; line-height: 1.7; color: #374151; }
        .wiki-content ul { list-style-type: disc; padding-left: 1.5rem; margin-top: 1rem; }
        .wiki-content li { margin-top: 0.5rem; }
        .wiki-content a { color: #2563eb; text-decoration: none; }
        .wiki-content a:hover { text-decoration: underline; }
      `}</style>
    </div>
  );
}
