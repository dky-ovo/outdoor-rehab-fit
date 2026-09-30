import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { resumeAssistantJobs } from '../utils/assistantJobs';

export default function AssistantJobSync() {
  const { user, isGuest, isLoading } = useAuth();
  const owner = user?.id && String(user.id), token = user?.token;
  useEffect(() => {
    if (!owner || !token || isGuest || isLoading) return;
    const flush = () => { if (!AppState.currentState || AppState.currentState === 'active') void resumeAssistantJobs({ owner, token }).catch(() => {}); };
    const subscription = AppState.addEventListener('change', flush);
    const interval = setInterval(flush, 3000); flush();
    return () => { subscription.remove(); clearInterval(interval); };
  }, [owner, token, isGuest, isLoading]);
  return null;
}
