import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { 
  ArrowUpLeft, Bell, Bookmark, ChevronDown, ChevronUp, Clock, Film, Filter, Heart, Home, 
  ImagePlus, MessageCircle, MessageSquare, MoreVertical, Plus, Repeat, Search, Send, 
  Settings, Share2, Sparkles, Star, Trash2, UserRound, Video, X, Edit3,
  Bot
} from 'lucide-react';

import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import AIAssistantModal from '@/components/AIAssistantModal';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { displayName, formatDate, normalizeProfile, type Post, type Profile } from '@/lib/types';
import NotFound from '@/pages/not-found';
import '@/index.css';

// --- المكونات المساعدة ---
function Avatar({ profile, large = false, storyBorder = false, isCloseFriends = false, extraLarge = false }: { profile?: Partial<Profile> | null; large?: boolean; storyBorder?: boolean; isCloseFriends?: boolean; extraLarge?: boolean }) {
  const initials = (displayName(profile).replace('@', '').trim().slice(0, 2) || 'آ').toUpperCase();
  const sizeClass = extraLarge ? 'w-16 h-16 text-lg' : large ? 'w-12 h-12 text-base' : 'w-8 h-8 text-xs';
  const borderClass = isCloseFriends 
    ? 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-zinc-900' 
    : storyBorder 
      ? 'ring-2 ring-pink-500 ring-offset-2 ring-offset-zinc-900' 
      : '';
  const baseClass = `rounded-full object-cover flex items-center justify-center font-bold bg-zinc-800 text-white shrink-0 ${sizeClass} ${borderClass}`;
  return profile?.avatar_url
    ? <img className={baseClass} src={profile.avatar_url} alt="" />
    : <span className={baseClass}>{initials}</span>;
}

// --- صفحة تسجيل الدخول وإنشاء الحساب ---
export function AuthPage({ mode, afterAuth }: { mode: 'login' | 'signup'; afterAuth: () => void }) {
  const signUp = mode === 'signup';
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabaseConfigured) { setError('إعدادات Supabase غير مكتملة في Secrets.'); return; }
    setBusy(true); setError(''); setSuccess('');
    try {
      if (signUp) {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { username: username.trim().toLowerCase(), full_name: fullName.trim() } },
        });
        if (authError) throw authError;
        if (data.session) { afterAuth(); setLocation('/feed'); } 
        else { setSuccess('أرسلنا رابط التحقق إلى بريدك الإلكتروني.'); }
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        afterAuth(); setLocation('/feed');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'حدث خطأ. حاول مرة أخرى.');
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-page">
      <div className="auth-scenery">
        <div className="sun-disc" />
        <div className="scenery-copy">
          <span>أهلًا بك في آني</span>
          <h2>هنا،<br />يبدأ الحديث<br /><em>ببساطة.</em></h2>
          <p>مساحة عربية للحظاتك وأحاديثك اليومية.</p>
        </div>
        <div className="scenery-lines" />
      </div>
      <section className="auth-panel">
        <Link href="/login" className="brand auth-brand">
          <span className="brand-mark">آ</span><span>آني <small>Aani</small></span>
        </Link>
        <div className="auth-form-wrap fade-up">
          <span className="eyebrow">{signUp ? 'انضم إلى آني' : 'سعدنا بعودتك'}</span>
          <h1>{signUp ? 'ابدأ مساحتك.' : 'أكمل حديثك.'}</h1>
          <p className="auth-lede">{signUp ? 'أنشئ حسابك وشارك ما يجعل يومك يومًا.' : 'سجّل الدخول لتعود إلى مجتمعك.'}</p>
          {!supabaseConfigured && <div className="notice notice-error" role="alert">أضف إعدادات Supabase للاتصال.</div>}
          {error && <div className="notice notice-error" role="alert">{error}</div>}
          {success && <div className="notice notice-success" role="status">{success}</div>}
          <form className="auth-form" onSubmit={submit}>
            {signUp && (
              <>
                <label className="field">
                  <span>الاسم الكامل</span>
                  <input required maxLength={80} value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" />
                </label>
                <label className="field">
                  <span>اسم المستخدم</span>
                  <input required minLength={3} maxLength={32} pattern="[A-Za-z0-9_.]+" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" dir="ltr" placeholder="username" />
                </label>
              </>
            )}
            <label className="field">
              <span>البريد الإلكتروني</span>
              <input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" dir="ltr" />
            </label>
            <label className="field">
              <span>كلمة المرور</span>
              <input required type="password" minLength={6} value={password} onChange={e => setPassword(e.target.value)} autoComplete={signUp ? 'new-password' : 'current-password'} dir="ltr" />
            </label>
            <button className="button-primary auth-submit" type="submit" disabled={busy || !supabaseConfigured}>
              {busy ? 'جارٍ المتابعة…' : signUp ? 'إنشاء حساب' : 'تسجيل الدخول'}
              <ArrowUpLeft size={17} />
            </button>
          </form>
          <p className="auth-switch">
            {signUp ? 'لديك حساب؟' : 'جديد هنا؟'} <Link href={signUp ? '/login' : '/signup'}>{signUp ? 'تسجيل الدخول' : 'أنشئ حسابًا'}</Link>
          </p>
        </div>
      </section>
    </div>
  );
}

// --- شريط القصص الموحد ---
function StoriesBar({ userId, currentProfile }: { userId: string; currentProfile: Profile | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const [groupedStories, setGroupedStories] = useState<{ [key: string]: any[] }>({});
  const [activeUserGroup, setActiveUserGroup] = useState<string | null>(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);

  const [showUI, setShowUI] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [replyText, setReplyText] = useState('');
  const [isLiked, setIsLiked] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [storyFile, setStoryFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [isCloseFriendsOnly, setIsCloseFriendsOnly] = useState(false);
  const [uploadDuration, setUploadDuration] = useState<number>(5);
  const [timedTexts, setTimedTexts] = useState<Array<{ id: string; text: string; startTime: number; endTime: number; x: number; y: number }>>([]);
  const [newText, setNewText] = useState('');
  const [textStart, setTextStart] = useState(0);
  const [textEnd, setTextEnd] = useState(5);
  const [uploading, setUploading] = useState(false);

  const fetchStories = useCallback(async () => {
    if (!supabaseConfigured || !userId) return;

    const { data: followings } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId);

    const followedIds = (followings || []).map(f => f.following_id);
    const allowedUserIds = [userId, ...followedIds];

    const { data } = await supabase
      .from('stories')
      .select('*, author:profiles(id, username, full_name, avatar_url)')
      .in('user_id', allowedUserIds)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true });

    if (data) {
      const groups: { [key: string]: any[] } = {};
      data.forEach(st => {
        const authorId = st.user_id;
        if (!groups[authorId]) groups[authorId] = [];
        groups[authorId].push(st);
      });
      setGroupedStories(groups);
    } else {
      setGroupedStories({});
    }
  }, [userId]);

  useEffect(() => { void fetchStories(); }, [fetchStories]);

  const activeStories = useMemo(() => {
    return activeUserGroup && groupedStories[activeUserGroup] ? groupedStories[activeUserGroup] : [];
  }, [activeUserGroup, groupedStories]);

  const currentStory = activeStories[activeStoryIndex] || null;
  const myStories = groupedStories[userId] || [];
  const hasMyStory = myStories.length > 0;

  useEffect(() => {
    if (!currentStory || !supabaseConfigured) return;
    void supabase.from('story_likes').select('id').eq('story_id', currentStory.id).eq('user_id', userId).maybeSingle().then(({ data }) => {
      setIsLiked(Boolean(data));
    });
  }, [currentStory, userId]);

  useEffect(() => {
    if (!currentStory || isPaused) return;
    const duration = (currentStory.duration_seconds || 5) * 1000;
    const interval = 50;
    const step = (interval / duration) * 100;

    const timer = setInterval(() => {
      setProgress(prev => {
        const nextProg = prev + step;
        setCurrentTimeSec((nextProg / 100) * (currentStory.duration_seconds || 5));
        if (nextProg >= 100) {
          handleNextStory();
          return 0;
        }
        return nextProg;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [currentStory, isPaused, activeStoryIndex, activeUserGroup]);

  const handleNextStory = () => {
    if (activeStoryIndex < activeStories.length - 1) {
      setActiveStoryIndex(prev => prev + 1);
      setProgress(0);
      setCurrentTimeSec(0);
    } else {
      const userIds = Object.keys(groupedStories);
      const currentIdx = userIds.indexOf(activeUserGroup || '');
      if (currentIdx !== -1 && currentIdx < userIds.length - 1) {
        setActiveUserGroup(userIds[currentIdx + 1]);
        setActiveStoryIndex(0);
        setProgress(0);
        setCurrentTimeSec(0);
      } else {
        setActiveUserGroup(null);
      }
    }
  };

  const handlePrevStory = () => {
    if (activeStoryIndex > 0) {
      setActiveStoryIndex(prev => prev - 1);
      setProgress(0);
      setCurrentTimeSec(0);
    } else {
      const userIds = Object.keys(groupedStories);
      const currentIdx = userIds.indexOf(activeUserGroup || '');
      if (currentIdx > 0) {
        const prevUser = userIds[currentIdx - 1];
        setActiveUserGroup(prevUser);
        setActiveStoryIndex(groupedStories[prevUser].length - 1);
        setProgress(0);
        setCurrentTimeSec(0);
      }
    }
  };

  const handleAddTimedText = () => {
    if (!newText.trim()) return;
    setTimedTexts([...timedTexts, {
      id: Math.random().toString(),
      text: newText.trim(),
      startTime: textStart,
      endTime: textEnd,
      x: 50,
      y: 50
    }]);
    setNewText('');
  };

  const handleToggleLike = async () => {
    if (!supabaseConfigured || !currentStory) return;
    if (isLiked) {
      await supabase.from('story_likes').delete().eq('story_id', currentStory.id).eq('user_id', userId);
      setIsLiked(false);
    } else {
      await supabase.from('story_likes').insert({ story_id: currentStory.id, user_id: userId });
      setIsLiked(true);
      if (currentStory.user_id !== userId) {
        await supabase.from('notifications').insert({
          user_id: currentStory.user_id,
          actor_id: userId,
          type: 'like',
          content: 'أعجب بستوريك',
          reference_id: currentStory.id
        });
      }
    }
  };

  const handleSendReply = async (customContent?: string) => {
    const textToSend = customContent || replyText;
    if (!supabaseConfigured || !currentStory || !textToSend.trim()) return;

    await supabase.from('messages').insert({
      sender_id: userId,
      recipient_id: currentStory.user_id,
      content: `رد على الستوري: ${textToSend.trim()}`,
    });

    if (currentStory.user_id !== userId) {
      await supabase.from('notifications').insert({
        user_id: currentStory.user_id,
        actor_id: userId,
        type: 'reply',
        content: `رد على ستوريك: ${textToSend.trim()}`,
        reference_id: currentStory.id
      });
    }

    setReplyText('');
    alert('تم إرسال الرد بنجاح!');
  };

  const handleUploadStory = async () => {
    if (!supabaseConfigured) return;
    if (!storyFile && !caption.trim()) return;

    setUploading(true);
    try {
      let publicUrl = '';
      let mediaType = 'text';

      if (storyFile) {
        const safeName = storyFile.name.replace(/[^a-zA-Z0-9._-]/g, '-');
        const filePath = `${userId}/story-${Date.now()}-${safeName}`;
        const { error: uploadErr } = await supabase.storage.from('media').upload(filePath, storyFile, { contentType: storyFile.type, upsert: true });
        if (uploadErr) throw uploadErr;
        publicUrl = supabase.storage.from('media').getPublicUrl(filePath).data.publicUrl;
        mediaType = storyFile.type.startsWith('video') ? 'video' : 'photo';
      }

      await supabase.from('stories').insert({
        user_id: userId,
        media_url: publicUrl || null,
        media_type: mediaType,
        caption: caption.trim() || null,
        is_close_friends: isCloseFriendsOnly,
        duration_seconds: uploadDuration,
        timed_texts: timedTexts
      });

      setStoryFile(null);
      setCaption('');
      setTimedTexts([]);
      setShowUploadModal(false);
      await fetchStories();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'تعذر نشر القصة.');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteStory = async () => {
    if (!supabaseConfigured || !currentStory) return;
    if (confirm('هل أنت تأكد من رغبتك في حذف هذه الستوري؟')) {
      await supabase.from('stories').delete().eq('id', currentStory.id);
      setShowMenu(false);
      await fetchStories();
      handleNextStory();
    }
  };

  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl mb-4 overflow-hidden transition-all duration-300">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/60">
        <span className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
          <Sparkles size={15} className="text-pink-500" /> قصص آني
        </span>
        <button onClick={() => setCollapsed(!collapsed)} className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 text-xs flex items-center gap-1">
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>

      {!collapsed && (
        <div className="p-3 flex items-center gap-4 overflow-x-auto no-scrollbar">
          <div className="flex flex-col items-center gap-1.5 shrink-0">
            <div className="relative cursor-pointer" onClick={() => {
              if (hasMyStory) {
                setActiveUserGroup(userId);
                setActiveStoryIndex(0);
                setProgress(0);
              } else {
                setShowUploadModal(true);
              }
            }}>
              <Avatar profile={currentProfile} extraLarge storyBorder={hasMyStory} />
              <button 
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowUploadModal(true);
                }} 
                className="absolute bottom-0 right-0 bg-pink-600 hover:bg-pink-700 text-white p-1 rounded-full border-2 border-zinc-900 shadow transition"
                title="إضافة ستوري جديدة"
              >
                <Plus size={14} />
              </button>
            </div>
            <span className="text-xs font-medium text-zinc-300 truncate w-16 text-center">قصتك</span>
          </div>

          {Object.keys(groupedStories).filter(id => id !== userId).map(authorId => {
            const firstStory = groupedStories[authorId][0];
            return (
              <div 
                key={authorId} 
                className="flex flex-col items-center gap-1.5 cursor-pointer shrink-0" 
                onClick={() => { setActiveUserGroup(authorId); setActiveStoryIndex(0); setProgress(0); setCurrentTimeSec(0); }}
              >
                <Avatar profile={firstStory.author} extraLarge storyBorder isCloseFriends={firstStory.is_close_friends} />
                <span className="text-xs text-zinc-300 truncate w-16 text-center font-medium">
                  {firstStory.author?.username || 'عضو'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {currentStory && (
        <div className="modal-overlay bg-black/95 flex items-center justify-center p-0 z-50">
          <div className="relative max-w-sm w-full h-[92vh] bg-black rounded-3xl overflow-hidden flex flex-col justify-between shadow-2xl border border-zinc-800/80 select-none">
            {showUI && (
              <div className="absolute top-2 inset-x-2 z-30 flex gap-1 px-1">
                {activeStories.map((st, idx) => (
                  <div key={st.id} className="h-0.5 flex-1 bg-white/30 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-white transition-all duration-75 ease-linear"
                      style={{ 
                        width: idx < activeStoryIndex ? '100%' : idx === activeStoryIndex ? `${progress}%` : '0%' 
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            {showUI && (
              <div className="absolute top-4 inset-x-0 z-30 flex items-center justify-between px-3 pt-2 text-white bg-gradient-to-b from-black/80 via-black/40 to-transparent">
                <Link href={`/profile/${currentStory.user_id}`} className="flex items-center gap-2">
                  <Avatar profile={currentStory.author} storyBorder={false} />
                  <div>
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-xs">{displayName(currentStory.author)}</span>
                      {currentStory.is_close_friends && (
                        <span className="bg-emerald-500 text-[9px] px-1.5 py-0.2 rounded-md font-semibold">أصدقاء مقربون</span>
                      )}
                    </div>
                    <span className="text-[10px] text-zinc-300 block">{formatDate(currentStory.created_at)}</span>
                  </div>
                </Link>

                <div className="flex items-center gap-2">
                  <button onClick={() => setShowMenu(!showMenu)} className="p-1 hover:bg-white/20 rounded-full">
                    <MoreVertical size={18} />
                  </button>
                  <button onClick={() => setActiveUserGroup(null)} className="p-1 hover:bg-white/20 rounded-full">
                    <X size={20} />
                  </button>
                </div>
              </div>
            )}

            {showMenu && (
              <div className="absolute top-14 left-3 z-40 bg-zinc-900 border border-zinc-800 rounded-xl p-2 shadow-xl text-xs space-y-1">
                {currentStory.user_id === userId ? (
                  <button onClick={handleDeleteStory} className="flex items-center gap-2 text-red-400 p-2 w-full hover:bg-zinc-800 rounded-lg">
                    <Trash2 size={14} /> حذف الستوري
                  </button>
                ) : (
                  <button onClick={() => { alert('تم رفع البلاغ للتحقق'); setShowMenu(false); }} className="p-2 w-full text-zinc-300 hover:bg-zinc-800 rounded-lg">
                    إبلاغ عن الستوري
                  </button>
                )}
              </div>
            )}

            <div className="relative w-full h-full flex items-center justify-center bg-zinc-950">
              {currentStory.media_url ? (
                currentStory.media_type === 'video' ? (
                  <video src={currentStory.media_url} autoPlay playsInline controls preload="metadata" className="w-full h-full object-contain" />
                ) : (
                  <img src={currentStory.media_url} alt="" className="w-full h-full object-contain" />
                )
              ) : (
                <div className="p-6 text-center text-white font-bold text-base bg-gradient-to-br from-pink-900 to-purple-900 w-full h-full flex items-center justify-center">
                  {currentStory.caption}
                </div>
              )}

              {(currentStory.timed_texts || []).map((tt: any) => {
                if (currentTimeSec >= tt.startTime && currentTimeSec <= tt.endTime) {
                  return (
                    <div 
                      key={tt.id}
                      style={{ top: `${tt.y}%`, left: `${tt.x}%`, transform: 'translate(-50%, -50%)' }}
                      className="absolute bg-black/70 text-white font-bold px-3 py-1.5 rounded-xl text-xs border border-white/20 backdrop-blur-sm z-20"
                    >
                      {tt.text}
                    </div>
                  );
                }
                return null;
              })}

              {currentStory.caption && currentStory.media_url && (
                <div className="absolute bottom-20 inset-x-4 bg-black/60 backdrop-blur-md p-3 rounded-xl text-center text-white text-xs z-10">
                  {currentStory.caption}
                </div>
              )}

              <div className="absolute inset-y-0 left-0 w-1/3 z-20" onClick={handleNextStory} />
              <div className="absolute inset-y-0 right-0 w-1/3 z-20" onClick={handlePrevStory} />
              <div 
                className="absolute inset-y-0 left-1/3 w-1/3 z-20"
                onClick={() => setShowUI(!showUI)}
                onMouseDown={() => setIsPaused(true)}
                onMouseUp={() => setIsPaused(false)}
                onTouchStart={() => setIsPaused(true)}
                onTouchEnd={() => setIsPaused(false)}
              />
            </div>

            {showUI && (
              <div className="absolute bottom-3 inset-x-3 z-30 flex items-center gap-2 bg-gradient-to-t from-black/90 via-black/50 to-transparent pt-4 pb-1">
                <div className="flex-1 flex items-center bg-zinc-900/90 border border-zinc-700/60 rounded-full px-3 py-1.5 shadow">
                  <input 
                    type="text" 
                    placeholder="رد..." 
                    value={replyText} 
                    onChange={e => setReplyText(e.target.value)} 
                    onKeyDown={e => { if (e.key === 'Enter') void handleSendReply(); }}
                    className="bg-transparent text-white text-xs outline-none w-full placeholder-zinc-400"
                  />
                  {replyText.trim() && (
                    <button onClick={() => void handleSendReply()} className="text-pink-500 font-bold text-xs mr-1">
                      إرسال
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-700/60 rounded-full px-2 py-1">
                  {['😲', '😂', '😍'].map(emoji => (
                    <button key={emoji} onClick={() => void handleSendReply(emoji)} className="hover:scale-125 transition text-base">
                      {emoji}
                    </button>
                  ))}
                </div>

                <button 
                  onClick={handleToggleLike} 
                  className={`p-2 rounded-full bg-zinc-900/80 border border-zinc-700/60 transition ${isLiked ? 'text-pink-500' : 'text-white'}`}
                >
                  <Heart size={18} fill={isLiked ? 'currentColor' : 'none'} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showUploadModal && (
        <div className="modal-overlay" onClick={() => setShowUploadModal(false)}>
          <div className="modal-content max-w-sm w-full bg-zinc-900 border border-zinc-800 p-4 rounded-2xl space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
              <h3 className="text-white font-bold text-sm flex items-center gap-1">
                <Filter size={16} className="text-pink-500" /> محرر القصة المتقدم
              </h3>
              <button className="text-zinc-400 hover:text-white" onClick={() => setShowUploadModal(false)}><X size={18} /></button>
            </div>

            <textarea 
              placeholder="اكتب شرحاً عاماً للستوري..." 
              value={caption} 
              onChange={e => setCaption(e.target.value)} 
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2 text-xs text-white outline-none resize-none"
              rows={2}
            />

            <div className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800/80 space-y-2 text-xs">
              <span className="font-semibold text-zinc-300 block">إضافة نص بتوقيت ظهور خاص:</span>
              <input 
                placeholder="اكتب النص..." 
                value={newText} 
                onChange={e => setNewText(e.target.value)} 
                className="w-full bg-zinc-900 p-2 rounded-lg text-white border border-zinc-800 outline-none"
              />
              <div className="flex gap-2 items-center text-[11px] text-zinc-400">
                <span>بدء (ثوانٍ):</span>
                <input type="number" min={0} max={90} value={textStart} onChange={e => setTextStart(Number(e.target.value))} className="w-12 bg-zinc-900 p-1 rounded border border-zinc-800 text-white" />
                <span>إنهاء:</span>
                <input type="number" min={1} max={90} value={textEnd} onChange={e => setTextEnd(Number(e.target.value))} className="w-12 bg-zinc-900 p-1 rounded border border-zinc-800 text-white" />
                <button onClick={handleAddTimedText} className="button-primary text-[10px] px-2 py-1 mr-auto">إضافة النص</button>
              </div>
            </div>

            <div className="flex justify-between items-center bg-zinc-950 p-2 rounded-xl text-xs text-zinc-300 border border-zinc-800">
              <span className="flex items-center gap-1"><Clock size={14} className="text-purple-400" /> مدة عرض الستوري:</span>
              <select value={uploadDuration} onChange={e => setUploadDuration(Number(e.target.value))} className="bg-zinc-900 border border-zinc-800 text-white p-1 rounded outline-none">
                <option value={5}>5 ثوانٍ</option>
                <option value={15}>15 ثانية</option>
                <option value={30}>30 ثانية</option>
                <option value={60}>60 ثانية</option>
                <option value={90}>90 ثانية (حجم أقصى)</option>
              </select>
            </div>

            <label className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 p-2.5 rounded-xl cursor-pointer hover:bg-zinc-800 text-xs text-zinc-300">
              <ImagePlus size={16} className="text-pink-400" />
              <span>{storyFile ? storyFile.name : 'اختيار صورة أو فيديو من الاستوديو'}</span>
              <input type="file" accept="image/*,video/*" className="hidden" onChange={e => e.target.files?.[0] && setStoryFile(e.target.files[0])} />
            </label>

            <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer pt-1">
              <input type="checkbox" checked={isCloseFriendsOnly} onChange={e => setIsCloseFriendsOnly(e.target.checked)} className="rounded accent-emerald-500" />
              <span className="flex items-center gap-1"><Star size={14} className="text-emerald-400" /> مخصصة للأصدقاء المقربين فقط</span>
            </label>

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
              <button className="button-secondary text-xs" onClick={() => setShowUploadModal(false)}>إلغاء</button>
              <button className="button-primary text-xs px-4" disabled={uploading || (!storyFile && !caption.trim() && !timedTexts.length)} onClick={handleUploadStory}>
                {uploading ? 'جاري النشر...' : 'نشر الستوري'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- كارت المنشور ---
function PostCard({ post, currentUserId, onRefresh }: { post: Post; currentUserId: string; onRefresh: () => void }) {
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);

  const liked = (post.likes || []).some(like => like.user_id === currentUserId);

  useEffect(() => {
    if (!supabaseConfigured) return;
    void supabase.from('reposts').select('id').eq('post_id', post.id).eq('user_id', currentUserId).maybeSingle().then(({ data }) => setReposted(Boolean(data)));
    void supabase.from('bookmarks').select('id').eq('post_id', post.id).eq('user_id', currentUserId).maybeSingle().then(({ data }) => setBookmarked(Boolean(data)));
  }, [post.id, currentUserId]);

  const toggleLike = async () => {
    if (!supabaseConfigured) return;
    if (liked) {
      await supabase.from('likes').delete().eq('post_id', post.id).eq('user_id', currentUserId);
    } else {
      await supabase.from('likes').insert({ post_id: post.id, user_id: currentUserId });
    }
    onRefresh();
  };

  const toggleRepost = async () => {
    if (!supabaseConfigured) return;
    if (reposted) {
      await supabase.from('reposts').delete().eq('post_id', post.id).eq('user_id', currentUserId);
      setReposted(false);
    } else {
      await supabase.from('reposts').insert({ post_id: post.id, user_id: currentUserId });
      setReposted(true);
    }
  };

  const toggleBookmark = async () => {
    if (!supabaseConfigured) return;
    if (bookmarked) {
      await supabase.from('bookmarks').delete().eq('post_id', post.id).eq('user_id', currentUserId);
      setBookmarked(false);
    } else {
      await supabase.from('bookmarks').insert({ post_id: post.id, user_id: currentUserId });
      setBookmarked(true);
    }
  };

  const loadComments = async () => {
    if (!supabaseConfigured) return;
    setBusy(true);
    const { data } = await supabase.from('comments').select('id,post_id,user_id,content,created_at,author:profiles(id,username,full_name,avatar_url)').eq('post_id', post.id).order('created_at', { ascending: true });
    setComments(data || []);
    setBusy(false);
  };

  const addComment = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabaseConfigured || !commentText.trim()) return;
    setBusy(true);
    await supabase.from('comments').insert({ post_id: post.id, user_id: currentUserId, content: commentText.trim() });
    setCommentText('');
    await loadComments();
    onRefresh();
    setBusy(false);
  };

  const handleDeletePost = async () => {
    if (!supabaseConfigured) return;
    if (confirm('هل أنت تأكد من رغبتك في حذف هذا المنشور؟')) {
      await supabase.from('posts').delete().eq('id', post.id);
      onRefresh();
    }
  };

  return (
    <article className="post-card card fade-up w-full overflow-hidden p-4 bg-zinc-900 border border-zinc-800 rounded-2xl mb-3 dir-rtl min-w-0">
      <div className="flex items-center justify-between w-full mb-2 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar profile={post.author} large />
          <div className="post-meta min-w-0 flex-1">
            <Link href={`/profile/${post.user_id}`} className="user-link block truncate">
              <strong className="text-white text-xs font-bold truncate block">{displayName(post.author)}</strong>
            </Link>
            <time className="text-[10px] text-zinc-400 block">{formatDate(post.created_at)}</time>
          </div>
        </div>
        {post.user_id === currentUserId && (
          <button onClick={handleDeletePost} className="text-zinc-500 hover:text-red-400 p-1 transition shrink-0" title="حذف المنشور">
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div className="post-body w-full min-w-0">
        {post.content && (
          <p className="text-xs my-2 text-zinc-200 whitespace-pre-line leading-relaxed break-words min-w-0 overflow-wrap-anywhere">
            {post.content}
          </p>
        )}

        {post.media_url && (post.type === 'reel'
          ? <video className="media-post rounded-xl mt-2 max-h-96 w-full object-cover" src={post.media_url} controls playsInline preload="metadata" />
          : <img className="media-post rounded-xl mt-2 max-h-96 w-full object-cover" src={post.media_url} alt="" />)}

        <div className="flex items-center justify-between text-xs text-zinc-400 border-t border-zinc-800/80 pt-2.5 mt-3 w-full shrink-0 flex-nowrap overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-4 shrink-0">
            <button type="button" className={`flex items-center gap-1 hover:text-pink-500 transition shrink-0 ${liked ? 'text-pink-500 font-bold' : ''}`} onClick={() => void toggleLike()}>
              <Heart size={18} fill={liked ? 'currentColor' : 'none'} />
              <span>{post.likes?.length || 0}</span>
            </button>

            <button type="button" className="flex items-center gap-1 hover:text-blue-400 transition shrink-0" onClick={() => comments === null ? void loadComments() : setComments(null)}>
              <MessageSquare size={17} />
              <span>{post.comments?.length || 0}</span>
            </button>

            <button type="button" className={`flex items-center gap-1 hover:text-emerald-400 transition shrink-0 ${reposted ? 'text-emerald-400 font-bold' : ''}`} onClick={toggleRepost}>
              <Repeat size={17} />
              <span>إعادة نشر</span>
            </button>

            <button type="button" className="flex items-center gap-1 hover:text-purple-400 transition shrink-0" onClick={() => alert('تم نسخ رابط المنشور للمشاركة!')}>
              <Share2 size={17} />
              <span>مشاركة</span>
            </button>
          </div>

          <button type="button" className={`hover:text-amber-400 transition shrink-0 ${bookmarked ? 'text-amber-400' : ''}`} onClick={toggleBookmark}>
            <Bookmark size={18} fill={bookmarked ? 'currentColor' : 'none'} />
          </button>
        </div>

        {comments && (
          <div className="comments-list mt-3 border-t border-zinc-800/40 pt-2 w-full">
            {busy && <p className="muted text-xs text-zinc-500">جاري تحميل التعليقات...</p>}
            {comments.map(c => (
              <p key={c.id} className="text-xs mb-1.5 text-zinc-300 break-words">
                <b className="text-white ml-1">{displayName(normalizeProfile(c.author))}:</b> {c.content}
              </p>
            ))}
            <form className="comment-form flex gap-1.5 mt-2 w-full" onSubmit={addComment}>
              <input className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-white w-full outline-none" value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="إضافة تعليق..." />
              <button className="button-primary text-xs px-3 py-1 shrink-0" type="submit" disabled={busy || !commentText.trim()}>نشر</button>
            </form>
          </div>
        )}
      </div>
    </article>
  );
}

// --- Hook الجلب الموحد للمنشورات والريلز ---
function usePosts(query: 'feed' | 'reel' | 'profile', targetUserId?: string) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabaseConfigured) { setPosts([]); setLoading(false); return; }
    setLoading(true);
    try {
      if (query === 'feed') {
        const { data: rawPosts, error: postsErr } = await supabase
          .from('posts')
          .select('id, user_id, content, media_url, type, created_at')
          .in('type', ['text', 'photo'])
          .order('created_at', { ascending: false })
          .limit(50);

        if (postsErr) throw postsErr;

        if (rawPosts && rawPosts.length > 0) {
          const uIds = [...new Set(rawPosts.map(p => p.user_id))];
          const { data: profs } = await supabase.from('profiles').select('id, username, full_name, avatar_url').in('id', uIds);
          const profMap = new Map((profs || []).map(p => [p.id, p]));

          const formatted = rawPosts.map(p => ({
            ...p,
            author: profMap.get(p.user_id) || { id: p.user_id, username: 'user', full_name: 'مستخدم آني' },
            likes: [],
            comments: []
          }));
          setPosts(formatted as unknown as Post[]);
        } else {
          setPosts([]);
        }
      } else if (query === 'profile' && targetUserId) {
        const { data: rawPosts, error: postsErr } = await supabase
          .from('posts')
          .select('id, user_id, content, media_url, type, created_at')
          .eq('user_id', targetUserId)
          .order('created_at', { ascending: false });

        if (postsErr) throw postsErr;

        if (rawPosts && rawPosts.length > 0) {
          const { data: profData } = await supabase
            .from('profiles')
            .select('id, username, full_name, avatar_url')
            .eq('id', targetUserId)
            .maybeSingle();

          const formattedPosts = rawPosts.map(p => ({
            ...p,
            author: profData || { id: targetUserId, username: 'user', full_name: 'مستخدم' },
            likes: [],
            comments: []
          }));

          setPosts(formattedPosts as unknown as Post[]);
        } else {
          setPosts([]);
        }
      } else if (query === 'reel') {
        const { data: rawPosts, error: postsErr } = await supabase
          .from('posts')
          .select('id, user_id, content, media_url, type, created_at')
          .eq('type', 'reel')
          .order('created_at', { ascending: false })
          .limit(50);

        if (postsErr) throw postsErr;

        if (rawPosts && rawPosts.length > 0) {
          const uIds = [...new Set(rawPosts.map(p => p.user_id))];
          const { data: profs } = await supabase.from('profiles').select('id, username, full_name, avatar_url').in('id', uIds);
          const profMap = new Map((profs || []).map(p => [p.id, p]));

          const formatted = rawPosts.map(p => ({
            ...p,
            author: profMap.get(p.user_id) || { id: p.user_id, username: 'user', full_name: 'مستخدم آني' },
            likes: [],
            comments: []
          }));
          setPosts(formatted as unknown as Post[]);
        } else {
          setPosts([]);
        }
      }
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [query, targetUserId]);

  useEffect(() => {
    void refresh();
    const onPostCreated = () => void refresh();
    window.addEventListener('aani:post-created', onPostCreated);
    return () => window.removeEventListener('aani:post-created', onPostCreated);
  }, [refresh]);

  return { posts, loading, refresh };
}

// --- الصفحة الرئيسية ---
function FeedPage({ userId, profile }: { userId: string; profile: Profile | null }) {
  const { posts, loading, refresh } = usePosts('feed');

  return (
    <section className="new-view w-full max-w-lg mx-auto">
      <StoriesBar userId={userId} currentProfile={profile} />

      {loading && <div className="loading-grid">{[1, 2].map(n => <div className="post-skeleton card" key={n}><i className="skeleton skeleton-avatar" /><div className="skeleton-copy"><i className="skeleton skeleton-line short" /></div></div>)}</div>}

      {!loading && posts.length === 0 && (
        <div className="empty-state card text-center p-8 border border-zinc-800 rounded-2xl bg-zinc-900/50">
          <div className="w-12 h-12 bg-pink-500/10 text-pink-500 rounded-full flex items-center justify-center mx-auto mb-3">
            <MessageCircle size={22} />
          </div>
          <h2 className="text-white font-bold text-base mb-1">لا يوجد محتوى منشور حالياً</h2>
          <p className="text-zinc-400 text-xs">انقر على علامة (+) في الأعلى لنشر أول منشور لك!</p>
        </div>
      )}

      {!loading && posts.length > 0 && <div className="posts-list space-y-3">{posts.map(post => <PostCard key={post.id} post={post} currentUserId={userId} onRefresh={() => void refresh()} />)}</div>}
    </section>
  );
}

// --- صفحة البحث ---
function SearchPage({ userId }: { userId: string }) {
  const [term, setTerm] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  const historyKey = `aani_search_history_${userId}`;

  useEffect(() => {
    const saved = localStorage.getItem(historyKey);
    if (saved) {
      try { setSearchHistory(JSON.parse(saved)); } catch {}
    }
  }, [historyKey]);

  const saveHistory = (newHistory: string[]) => {
    setSearchHistory(newHistory);
    localStorage.setItem(historyKey, JSON.stringify(newHistory));
  };

  const handleSearch = async (queryTerm: string) => {
    if (!supabaseConfigured || !queryTerm.trim()) return;
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url, bio')
      .or(`username.ilike.%${queryTerm.trim()}%,full_name.ilike.%${queryTerm.trim()}%`)
      .limit(30);

    setProfiles((data || []) as Profile[]);
    setLoading(false);

    if (!searchHistory.includes(queryTerm.trim())) {
      saveHistory([queryTerm.trim(), ...searchHistory.slice(0, 9)]);
    }
  };

  const deleteHistoryItem = (itemToDelete: string) => {
    saveHistory(searchHistory.filter(item => item !== itemToDelete));
  };

  const clearAllHistory = () => {
    saveHistory([]);
  };

  return (
    <section className="new-view space-y-4 max-w-lg mx-auto">
      <form className="toolbar flex gap-2" onSubmit={e => { e.preventDefault(); handleSearch(term); }}>
        <label className="searchbox flex-1 bg-zinc-950 border border-zinc-700/80 rounded-2xl px-4 py-3 flex items-center gap-3 shadow-inner">
          <Search size={20} className="text-pink-500" />
          <input 
            value={term} 
            onChange={e => setTerm(e.target.value)} 
            placeholder="ابحث عن الاسم واسم المستخدم (@username)..." 
            className="w-full bg-transparent outline-none text-sm text-white placeholder-zinc-500 font-medium"
          />
        </label>
        <button className="button-primary text-xs px-5 py-3 rounded-2xl font-bold" type="submit">بحث</button>
      </form>

      {!term && searchHistory.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-2xl space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="text-zinc-400 font-semibold">عمليات البحث الأخيرة</span>
            <button onClick={clearAllHistory} className="text-pink-400 hover:underline">مسح الكل</button>
          </div>
          <div className="space-y-1">
            {searchHistory.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between p-2 rounded-xl hover:bg-zinc-800/60 text-xs">
                <span onClick={() => { setTerm(item); handleSearch(item); }} className="text-zinc-200 cursor-pointer flex-1 font-medium">
                  🔍 {item}
                </span>
                <button onClick={() => deleteHistoryItem(item)} className="text-zinc-500 hover:text-red-400 p-1">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && <div className="status-box">جاري البحث عن الحسابات...</div>}

      {!loading && profiles.length > 0 && (
        <div className="card space-y-2">
          {profiles.map(p => (
            <Link key={p.id} href={`/profile/${p.id}`} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-800/50">
              <div className="flex items-center gap-3">
                <Avatar profile={p} large />
                <div>
                  <strong className="text-xs text-white block font-bold">{displayName(p)}</strong>
                  <span className="text-[11px] text-zinc-400" dir="ltr">@{p.username}</span>
                </div>
              </div>
              <ArrowUpLeft size={16} className="text-zinc-500" />
            </Link>
          ))}
        </div>
      )}

      {!loading && term.trim() && profiles.length === 0 && (
        <div className="empty-state card">
          <h2>لا توجد نتائج مطابقة</h2>
          <p className="text-xs text-zinc-400">تأكد من كتابة اسم المستخدم أو الاسم الصحيح.</p>
        </div>
      )}
    </section>
  );
}

// --- صفحة الرسائل ---
function MessagesPage({ currentUserId, selectedId }: { currentUserId: string; selectedId?: string }) {
  const [, setLocation] = useLocation();
  const [contacts, setContacts] = useState<Profile[]>([]);
  const [target, setTarget] = useState<Profile | null>(null);
  const [thread, setThread] = useState<any[]>([]);
  const [text, setText] = useState('');

  const loadThread = useCallback(async () => {
    if (!supabaseConfigured || !selectedId) return;
    const { data } = await supabase
      .from('messages')
      .select('id, sender_id, recipient_id, content, created_at')
      .or(`and(sender_id.eq.${currentUserId},recipient_id.eq.${selectedId}),and(sender_id.eq.${selectedId},recipient_id.eq.${currentUserId})`)
      .order('created_at', { ascending: true });
    setThread(data || []);
  }, [currentUserId, selectedId]);

  useEffect(() => {
    if (!supabaseConfigured) return;
    const loadContacts = async () => {
      const { data: msgs } = await supabase
        .from('messages')
        .select('sender_id, recipient_id')
        .or(`sender_id.eq.${currentUserId},recipient_id.eq.${currentUserId}`)
        .order('created_at', { ascending: false });

      const ids = [...new Set((msgs || []).flatMap(m => [m.sender_id, m.recipient_id]).filter(id => id !== currentUserId))];
      if (selectedId && !ids.includes(selectedId)) ids.unshift(selectedId);

      if (ids.length) {
        const { data: profs } = await supabase.from('profiles').select('id, username, full_name, avatar_url').in('id', ids);
        setContacts((profs || []) as Profile[]);
      } else {
        setContacts([]);
      }
    };
    void loadContacts();
  }, [currentUserId, selectedId]);

  useEffect(() => {
    if (!selectedId || !supabaseConfigured) return;
    setTarget(contacts.find(c => c.id === selectedId) || null);
    void loadThread();

    const channel = supabase.channel(`realtime-msgs-${selectedId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => void loadThread())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [selectedId, contacts, loadThread]);

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabaseConfigured || !selectedId || !text.trim()) return;
    await supabase.from('messages').insert({ sender_id: currentUserId, recipient_id: selectedId, content: text.trim() });
    setText('');
    await loadThread();
  };

  return (
    <section className="new-view max-w-lg mx-auto">
      <div className="page-heading mb-3"><div><span className="eyebrow">محادثات مباشرة</span><h1 className="text-white text-base font-bold">الرسائل</h1></div></div>

      {!selectedId ? (
        contacts.length > 0 ? (
          <div className="card space-y-2">
            {contacts.map(c => (
              <Link key={c.id} href={`/messages/${c.id}`} className="flex items-center justify-between p-2 rounded-xl hover:bg-zinc-800/50">
                <div className="flex items-center gap-2">
                  <Avatar profile={c} />
                  <div>
                    <strong className="text-xs text-white block">{displayName(c)}</strong>
                    <span className="text-[10px] text-zinc-400" dir="ltr">@{c.username}</span>
                  </div>
                </div>
                <ArrowUpLeft size={16} className="text-zinc-500" />
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state card"><h2>لا توجد محادثات بعد</h2><p className="text-xs text-zinc-400">ابدأ محادثة مع أصدقائك عبر بروفايلهم!</p></div>
        )
      ) : (
        <div className="card flex flex-col h-[70vh]">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-2">
            <button onClick={() => setLocation('/messages')} className="text-xs text-pink-500 flex items-center gap-1"><ArrowUpLeft size={14} /> كل الرسائل</button>
            {target && <strong className="text-xs text-white">{displayName(target)}</strong>}
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 p-2">
            {thread.map(m => (
              <div key={m.id} className={`max-w-[75%] p-2 rounded-xl text-xs ${m.sender_id === currentUserId ? 'bg-pink-600 text-white mr-auto' : 'bg-zinc-800 text-zinc-200 ml-auto'}`}>
                {m.content}
              </div>
            ))}
          </div>
          <form className="flex gap-2 pt-2 border-t border-zinc-800" onSubmit={sendMessage}>
            <input value={text} onChange={e => setText(e.target.value)} placeholder="اكتب رسالة..." className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl p-2 text-xs text-white outline-none" />
            <button type="submit" className="button-primary text-xs px-3"><Send size={14} /></button>
          </form>
        </div>
      )}
    </section>
  );
}

// --- الملف الشخصي ---
function ProfilePage({ targetUserId, currentUserId, profile, onProfileUpdate }: { targetUserId: string; currentUserId: string; profile: Profile | null; onProfileUpdate: (next: Profile) => void }) {
  const activeUserId = targetUserId || currentUserId;
  const own = activeUserId === currentUserId;

  const [person, setPerson] = useState<Profile | null>(own ? profile : null);
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [postCount, setPostCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);

  const { posts, loading, refresh } = usePosts('profile', activeUserId);

  useEffect(() => {
    if (!supabaseConfigured || !activeUserId) return;
    const loadProfileData = async () => {
      const [{ data: prof }, { count: fCount }, { count: fingCount }, { count: pCount }, { data: checkFollow }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', activeUserId).maybeSingle(),
        supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', activeUserId),
        supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', activeUserId),
        supabase.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', activeUserId),
        own ? Promise.resolve({ data: null }) : supabase.from('follows').select('*').eq('follower_id', currentUserId).eq('following_id', activeUserId).maybeSingle()
      ]);
      if (prof) setPerson(prof as Profile);
      setFollowers(fCount || 0);
      setFollowing(fingCount || 0);
      setPostCount(pCount || 0);
      setIsFollowing(Boolean(checkFollow));
    };
    void loadProfileData();
  }, [activeUserId, currentUserId, own]);

  const toggleFollow = async () => {
    if (!supabaseConfigured) return;
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', currentUserId).eq('following_id', activeUserId);
      setFollowers(prev => prev - 1);
    } else {
      await supabase.from('follows').insert({ follower_id: currentUserId, following_id: activeUserId });
      setFollowers(prev => prev + 1);
    }
    setIsFollowing(!isFollowing);
  };

  if (!person) return <div className="status-box">جاري تحميل البروفايل...</div>;

  return (
    <section className="new-view space-y-4 max-w-lg mx-auto">
      <div className="profile-banner card flex items-center gap-4 p-4 border border-zinc-800 rounded-2xl bg-zinc-900/80">
        <Avatar profile={person} extraLarge />
        <div className="flex-1">
          <strong dir="ltr" className="text-white text-sm block font-bold">@{person.username}</strong>
          <p className="text-xs text-zinc-400 my-1">{person.bio || 'لا توجد نبذة شخصية'}</p>

          <div className="flex gap-4 my-2 text-xs text-zinc-300">
            <span><b className="text-white">{postCount}</b> منشور</span>
            <span><b className="text-white">{followers}</b> متابِع</span>
            <span><b className="text-white">{following}</b> يتابع</span>
          </div>

          {!own && (
            <div className="flex gap-2 mt-2">
              <button className={`action-button text-xs px-4 py-1.5 rounded-xl font-bold ${isFollowing ? 'bg-zinc-800 text-zinc-300' : 'bg-pink-600 text-white'}`} onClick={toggleFollow}>
                {isFollowing ? 'إلغاء المتابعة' : 'متابعة'}
              </button>
              <Link href={`/messages/${activeUserId}`} className="action-button text-xs px-4 py-1.5 rounded-xl bg-zinc-800 text-white font-medium">رسالة</Link>
            </div>
          )}
        </div>
      </div>

      <h2 className="section-label my-2 text-sm font-bold text-white">منشورات وريلز المستخدم</h2>
      {loading && <div className="status-box">جاري تحميل المنشورات...</div>}
      {!loading && posts.length === 0 && <div className="empty-state card text-center p-6 text-zinc-400 text-xs">لا يوجد محتوى منشور حالياً لهذا المستخدم</div>}

      {!loading && posts.length > 0 && (
        <div className="posts-list space-y-3">
          {posts.map(post => (
            <PostCard key={post.id} post={post} currentUserId={currentUserId} onRefresh={() => void refresh()} />
          ))}
        </div>
      )}
    </section>
  );
}

// --- صفحة Reels ---
function ReelsPage({ userId }: { userId: string }) {
  const { posts, loading, refresh } = usePosts('reel');
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editFile, setEditFile] = useState<File | null>(null);
  const [updating, setUpdating] = useState(false);

  const handleUpdateReel = async () => {
    if (!supabaseConfigured || !editingPost) return;
    setUpdating(true);
    try {
      let mediaUrl = editingPost.media_url;

      if (editFile) {
        const safeName = editFile.name.replace(/[^a-zA-Z0-9._-]/g, '-');
        const uploadedPath = `${userId}/reel-${Date.now()}-${safeName}`;
        const { error: uploadErr } = await supabase.storage.from('media').upload(uploadedPath, editFile, { upsert: true, contentType: editFile.type });
        if (uploadErr) throw uploadErr;
        mediaUrl = supabase.storage.from('media').getPublicUrl(uploadedPath).data.publicUrl;
      }

      await supabase.from('posts').update({
        content: editContent,
        media_url: mediaUrl
      }).eq('id', editingPost.id);

      setEditingPost(null);
      setEditFile(null);
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'فشل تعديل الريل.');
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteReel = async (postId: string) => {
    if (!supabaseConfigured) return;
    if (confirm('هل أنت تأكد من رغبتك في حذف مقطع الريل هذا نهائياً؟')) {
      await supabase.from('posts').delete().eq('id', postId);
      refresh();
    }
  };

  return (
    <section className="new-view p-0 max-w-lg mx-auto">
      {loading && <div className="status-box">جاري تحميل الريلز...</div>}
      {!loading && !posts.length && (
        <div className="empty-state card text-center py-12">
          <Film size={32} className="mx-auto text-pink-500 mb-2" />
          <h2 className="text-white font-bold">لا يوجد ريلز منشور حالياً</h2>
          <p className="text-xs text-zinc-400 mt-1">انقر على علامة (+) بالأعلى لنشر أول فيديو لك!</p>
        </div>
      )}

      <div className="reels-feed space-y-4">
        {posts.map(post => (
          <article className="relative w-full h-[82vh] bg-black rounded-3xl overflow-hidden flex items-center justify-center border border-zinc-800 shadow-2xl" key={post.id}>
            <video 
              src={post.media_url || ''} 
              autoPlay 
              loop 
              muted 
              playsInline 
              controls
              preload="metadata"
              className="w-full h-full object-cover" 
            />

            <div className="absolute bottom-4 right-4 left-16 z-20 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 rounded-2xl backdrop-blur-xs text-white">
              <strong className="text-xs block font-bold">{displayName(post.author)}</strong>
              {post.content && <p className="text-xs text-zinc-200 mt-1">{post.content}</p>}
            </div>

            <div className="absolute right-3 bottom-12 z-30 flex flex-col items-center gap-4 text-white bg-black/40 p-2 rounded-full backdrop-blur-md border border-white/10">
              <button className="flex flex-col items-center gap-0.5 hover:text-pink-500 transition">
                <Heart size={20} />
                <span className="text-[10px] font-bold">{post.likes?.length || 0}</span>
              </button>

              <button className="flex flex-col items-center gap-0.5 hover:text-blue-400 transition">
                <MessageSquare size={19} />
                <span className="text-[10px] font-bold">{post.comments?.length || 0}</span>
              </button>

              <button className="flex flex-col items-center gap-0.5 hover:text-emerald-400 transition">
                <Repeat size={19} />
              </button>

              <button className="flex flex-col items-center gap-0.5 hover:text-purple-400 transition" onClick={() => alert('تم نسخ رابط الريل للمشاركة!')}>
                <Share2 size={19} />
              </button>

              <button className="hover:text-amber-400 transition" onClick={() => {
                if (post.user_id === userId) {
                  setEditingPost(post);
                  setEditContent(post.content || '');
                } else {
                  alert('تم حفظ الريل للمفضلة!');
                }
              }}>
                <MoreVertical size={20} />
              </button>
            </div>
          </article>
        ))}
      </div>

      {editingPost && (
        <div className="modal-overlay" onClick={() => setEditingPost(null)}>
          <div className="modal-content max-w-sm w-full bg-zinc-900 border border-zinc-800 p-4 rounded-2xl space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
              <h3 className="font-bold text-white text-sm flex items-center gap-1">
                <Edit3 size={16} className="text-pink-500" /> تعديل/استبدال مقطع الريل
              </h3>
              <button onClick={() => setEditingPost(null)}><X size={18} className="text-zinc-400" /></button>
            </div>

            <textarea 
              value={editContent} 
              onChange={e => setEditContent(e.target.value)} 
              className="w-full bg-zinc-950 border border-zinc-800 p-2.5 rounded-xl text-xs text-white outline-none resize-none"
              rows={3}
            />

            <label className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 p-2.5 rounded-xl cursor-pointer hover:bg-zinc-800 text-xs text-zinc-300">
              <Video size={16} className="text-purple-400" />
              <span>{editFile ? editFile.name : 'استبدال ملف الفيديو الحالي بمقطع جديد'}</span>
              <input type="file" accept="video/*" className="hidden" onChange={e => e.target.files?.[0] && setEditFile(e.target.files[0])} />
            </label>

            <div className="flex justify-between items-center pt-2 border-t border-zinc-800">
              <button onClick={() => handleDeleteReel(editingPost.id)} className="text-xs text-red-400 flex items-center gap-1 hover:underline">
                <Trash2 size={14} /> حذف المقطع
              </button>
              <button disabled={updating} onClick={handleUpdateReel} className="button-primary text-xs px-4">
                {updating ? 'جاري الحفظ...' : 'حفظ التغييرات'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  currentProfile: Profile | null;
  onSignOut: () => void;
};

// --- نافذة الإعدادات ---
function SettingsModal({ isOpen, onClose, currentProfile, onSignOut }: SettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <section
        className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900 p-4 text-white shadow-2xl flex flex-col h-[80vh]"
        role="dialog"
        aria-modal="true"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <Settings size={18} />
            <h2 className="text-sm font-bold">إعدادات الحساب</h2>
          </div>
          <button type="button" onClick={onClose} data-testid="button-close-settings" className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 pt-4 flex-1">
          <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <Avatar profile={currentProfile} large />
            <div className="min-w-0">
              <strong className="block truncate text-sm">{displayName(currentProfile)}</strong>
              {currentProfile?.username && <span className="text-xs text-zinc-400" dir="ltr">@{currentProfile.username}</span>}
            </div>
          </div>
          <p className="text-xs leading-6 text-zinc-400">إدارة جلسة تسجيل الدخول وإعدادات حسابك في آني.</p>
          <button type="button" onClick={onSignOut} data-testid="button-sign-out" className="w-full rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-300 hover:bg-red-500/20">
            تسجيل الخروج
          </button>
        </div>
      </section>
    </div>
  );
}

type NotificationItem = {
  id: string;
  content: string;
  type: string;
  is_read: boolean;
  created_at: string;
};

function NotificationsModal({ isOpen, onClose, currentUserId }: { isOpen: boolean; onClose: () => void; currentUserId: string }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (!supabaseConfigured) {
      setError('إعدادات Supabase غير مكتملة.');
      setItems([]);
      return;
    }

    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      const { data, error: queryError } = await supabase
        .from('notifications')
        .select('id,content,type,is_read,created_at')
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false })
        .limit(40);
      if (!active) return;
      if (queryError) {
        setItems([]);
        setError(queryError.message);
      } else {
        setItems((data || []) as NotificationItem[]);
      }
      setLoading(false);
    };

    void load();
    return () => { active = false; };
  }, [isOpen, currentUserId]);

  const markAllRead = async () => {
    if (!supabaseConfigured || !items.some(item => !item.is_read)) return;
    setUpdating(true);
    setError('');
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', currentUserId)
      .eq('is_read', false);
    if (updateError) setError(updateError.message);
    else setItems(current => current.map(item => ({ ...item, is_read: true })));
    setUpdating(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <section
        className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 text-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aani-notifications-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 p-4">
          <h2 id="aani-notifications-title" className="flex items-center gap-2 text-base font-bold">
            <Bell size={18} /> الإشعارات
          </h2>
          <div className="flex items-center gap-3">
            {items.some(item => !item.is_read) && (
              <button type="button" onClick={() => void markAllRead()} disabled={updating} className="text-xs text-pink-400 disabled:opacity-50">
                {updating ? 'جارٍ التحديث…' : 'تحديد الكل كمقروء'}
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="إغلاق الإشعارات" className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="max-h-[65vh] overflow-y-auto p-4">
          {loading && <p className="py-8 text-center text-sm text-zinc-400">جارٍ تحميل الإشعارات…</p>}
          {!loading && error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
          {!loading && !error && items.length === 0 && <p className="py-8 text-center text-sm text-zinc-400">لا توجد إشعارات جديدة.</p>}
          {!loading && !error && items.map(item => (
            <article key={item.id} className={`mb-2 rounded-xl border p-3 ${item.is_read ? 'border-zinc-800 bg-zinc-950/40' : 'border-pink-500/30 bg-pink-500/5'}`}>
              <p className="text-sm">{item.content || 'لديك إشعار جديد في آني.'}</p>
              <time className="mt-1 block text-[11px] text-zinc-500">{formatDate(item.created_at)}</time>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

// --- الهيكل الرئيسي لتطبيق آني (Shell) ---
function Shell({ children, profile, userId, onSignOut }: { children: ReactNode; profile: Profile | null; userId: string; onSignOut: () => void }) {
  const [path, setLocation] = useLocation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showNotifsModal, setShowNotifsModal] = useState(false);
  const [showAssistantModal, setShowAssistantModal] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const [postText, setPostText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<'image' | 'video' | null>(null);
  const [overlayText, setOverlayText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    if (!supabaseConfigured || !userId) return;
    void supabase.from('notifications').select('id', { count: 'exact' }).eq('user_id', userId).eq('is_read', false).then(({ count }) => {
      setUnreadCount(count || 0);
    });
  }, [userId, showNotifsModal]);

  const previewUrl = useMemo(() => selectedFile ? URL.createObjectURL(selectedFile) : null, [selectedFile]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const handlePublish = async () => {
    if (!supabaseConfigured) {
      setCreateError('إعدادات الاتصال بقاعدة البيانات غير مكتملة في Secrets.');
      return;
    }

    const content = postText.trim();
    if (!content && !selectedFile) return;

    setIsSubmitting(true);
    setCreateError('');
    try {
      let mediaUrl: string | null = null;
      let type: 'text' | 'photo' | 'reel' = 'text';

      if (selectedFile && fileType) {
        const safeName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '-');
        const uploadedPath = `${userId}/${Date.now()}-${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from('media')
          .upload(uploadedPath, selectedFile, { upsert: true, contentType: selectedFile.type });

        if (uploadError) throw new Error(`فشل رفع الملف: ${uploadError.message}`);

        const publicData = supabase.storage.from('media').getPublicUrl(uploadedPath);
        mediaUrl = publicData.data.publicUrl;
        type = fileType === 'image' ? 'photo' : 'reel';
      }

      const { error: postError } = await supabase.from('posts').insert({
        user_id: userId,
        content: overlayText ? `${content}\n[نص الصورة: ${overlayText}]` : content,
        media_url: mediaUrl,
        type,
      });

      if (postError) throw new Error(`فشل حفظ المنشور: ${postError.message}`);

      setPostText('');
      setOverlayText('');
      setSelectedFile(null);
      setFileType(null);
      setShowCreateModal(false);
      window.dispatchEvent(new Event('aani:post-created'));

      if (type === 'reel') {
        setLocation('/reels');
      } else {
        setLocation('/feed');
      }
    } catch (err: any) {
      setCreateError(err.message || 'حدث خطأ غير متوقع أثناء النشر.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const nav = [
    ['/feed', Home, 'الرئيسية', 'feed'],
    ['/reels', Film, 'ريلز', 'reels'],
    ['/search', Search, 'البحث', 'search'],
    ['/messages', MessageCircle, 'الرسائل', 'messages'],
    ['/profile', UserRound, 'ملفي', 'profile'],
  ] as const;

  return (
    <div className="app-frame min-h-screen bg-black text-white">
      <header className="topbar grid grid-cols-3 items-center px-4 py-2.5 bg-zinc-900/90 border-b border-zinc-800 sticky top-0 z-40">
        <div className="flex items-center justify-start">
          <button className="relative p-2 rounded-full hover:bg-zinc-800 text-zinc-300" onClick={() => setShowNotifsModal(true)}>
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 bg-pink-600 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center justify-center">
          <Link href="/feed" className="brand font-bold text-lg text-white flex items-center gap-1">
            <span className="brand-mark bg-gradient-to-r from-pink-500 to-purple-600 text-white px-2 py-0.5 rounded-lg text-sm">آ</span>
            <span>آني <small className="text-[10px] text-zinc-400 font-normal">Aani</small></span>
          </Link>
        </div>

        <div className="flex items-center justify-end gap-2">
          {path.startsWith('/profile') && (
            <button className="icon-button text-zinc-300" onClick={() => setShowSettingsModal(true)}>
              <Settings size={20} />
            </button>
          )}
          <button className="icon-button bg-pink-600 text-white p-1.5 rounded-full shadow" onClick={() => setShowCreateModal(true)}>
            <Plus size={20} />
          </button>
        </div>
      </header>

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <h3 className="font-semibold text-white text-sm">منشور جديد</h3>
              <button className="text-zinc-400" onClick={() => setShowCreateModal(false)}><X size={18} /></button>
            </div>

            <textarea 
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
              placeholder="اكتب شرحاً للمنشور..." 
              className="w-full p-3 border rounded-xl resize-none outline-none bg-zinc-950 border-zinc-800 text-white text-xs" 
              rows={3} 
            />

            {selectedFile && (
              <div className="relative w-full rounded-xl overflow-hidden border border-zinc-800 bg-black aspect-square flex items-center justify-center">
                {fileType === 'image' ? (
                  <img src={previewUrl || ''} alt="" className="w-full h-full object-cover" />
                ) : (
                  <video src={previewUrl || ''} controls className="w-full h-full object-cover" />
                )}
                <button type="button" onClick={() => { setSelectedFile(null); setFileType(null); }} className="absolute top-2 right-2 bg-black/70 text-white rounded-full p-1">
                  <X size={14} />
                </button>
              </div>
            )}

            <input type="file" id="image-upload" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) { setSelectedFile(e.target.files[0]); setFileType('image'); } }} />
            <input type="file" id="video-upload" accept="video/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) { setSelectedFile(e.target.files[0]); setFileType('video'); } }} />

            <div className="flex items-center justify-between pt-2 border-t border-zinc-800 text-xs">
              <div className="flex gap-2">
                <label htmlFor="image-upload" className="flex items-center gap-1 px-3 py-2 text-pink-400 bg-pink-950/40 rounded-xl cursor-pointer">
                  <ImagePlus size={15} /> صورة
                </label>
                <label htmlFor="video-upload" className="flex items-center gap-1 px-3 py-2 text-purple-400 bg-purple-950/40 rounded-xl cursor-pointer">
                  <Video size={15} /> فيديو
                </label>
              </div>

              <button 
                type="button"
                onClick={() => void handlePublish()}
                disabled={isSubmitting || (!postText.trim() && !selectedFile)}
                className="px-5 py-2 bg-pink-600 disabled:opacity-50 text-white rounded-xl font-semibold"
              >
                {isSubmitting ? 'جاري النشر...' : 'نشر'}
              </button>
            </div>
            {createError && <p className="text-xs text-red-400">{createError}</p>}
          </div>
        </div>
      )}

      <SettingsModal isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} currentProfile={profile} onSignOut={onSignOut} />
      <NotificationsModal isOpen={showNotifsModal} onClose={() => setShowNotifsModal(false)} currentUserId={userId} />

      {/* زر المساعد الذكي العائم على الشاشة */}
      <button
        onClick={() => setShowAssistantModal(true)}
        data-testid="button-open-assistant"
        className="fixed bottom-20 left-6 z-50 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white p-3.5 rounded-full shadow-2xl flex items-center justify-center transition-transform hover:scale-110 active:scale-95 border border-white/20"
        title="فتح المساعد الذكي"
      >
        <Bot className="w-6 h-6" />
      </button>

      {/* نافذة المساعد الذكي المباشرة */}
      <AIAssistantModal 
        open={showAssistantModal} 
        onClose={() => setShowAssistantModal(false)} 
      />

      <div className="content-shell pb-16">
        <main className="main-content">{children}</main>
        <nav className="mobile-nav fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 flex justify-around p-2 z-40">
          {nav.map(([href, Icon, label, id]) => (
            <Link key={id} href={href} className={`flex flex-col items-center gap-1 text-[10px] ${path === href || (id === 'profile' && path.startsWith('/profile')) ? 'text-pink-500 font-bold' : 'text-zinc-400'}`}>
              <Icon size={19} /><span>{label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

function App() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const user = session?.user;

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    if (!supabaseConfigured) { setAuthLoading(false); return; }
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, next) => { setSession(next); setProfile(null); });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabaseConfigured || !user?.id) return;
    void supabase.from('profiles').select('*').eq('id', user.id).maybeSingle().then(({ data }) => setProfile(data as Profile | null));
  }, [user?.id]);

  const signOut = async () => { 
    if (supabaseConfigured) await supabase.auth.signOut(); 
    setSession(null); 
    setProfile(null); 
  };

  if (authLoading) return <div className="loading-screen"><div className="loading-brand">آني Aani</div></div>;

  return (
    <TooltipProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        {user ? (
          <Shell userId={user.id} profile={profile} onSignOut={() => void signOut()}>
            <Switch>
              <Route path="/feed"><FeedPage userId={user.id} profile={profile} /></Route>
              <Route path="/"><FeedPage userId={user.id} profile={profile} /></Route>
              <Route path="/reels"><ReelsPage userId={user.id} /></Route>
              <Route path="/search"><SearchPage userId={user.id} /></Route>
              <Route path="/messages"><MessagesPage currentUserId={user.id} /></Route>
              <Route path="/messages/:userId">{params => <MessagesPage currentUserId={user.id} selectedId={params.userId} />}</Route>
              <Route path="/profile">{() => <ProfilePage targetUserId={user.id} currentUserId={user.id} profile={profile} onProfileUpdate={setProfile} />}</Route>
              <Route path="/profile/:userId">{params => <ProfilePage key={params.userId} targetUserId={params.userId} currentUserId={user.id} profile={profile} onProfileUpdate={setProfile} />}</Route>
              <Route component={NotFound} />
            </Switch>
          </Shell>
        ) : (
          <Switch>
            <Route path="/signup"><AuthPage mode="signup" afterAuth={() => undefined} /></Route>
            <Route path="/login"><AuthPage mode="login" afterAuth={() => undefined} /></Route>
            <Route path="/"><AuthPage mode="login" afterAuth={() => undefined} /></Route>
            <Route component={NotFound} />
          </Switch>
        )}
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;