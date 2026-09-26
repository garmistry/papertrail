/** Maps updater events to the small notification rendered by the app shell. */
export function updateNoticeView(status = {}) {
  if (status.state === 'available') return {
    title: `Papertrail ${status.version} is available`,
    message: 'Download it without leaving the app.',
    action: 'Download',
    progress: null
  };
  if (status.state === 'downloading') {
    const progress = Math.max(0, Math.min(100, Number(status.percent) || 0));
    return { title: 'Downloading update', message: `${progress}% complete`, action: null, progress };
  }
  if (status.state === 'downloaded') return {
    title: `Papertrail ${status.version} is ready`,
    message: 'Restart to install the update.',
    action: 'Restart & Install',
    progress: null
  };
  if (status.state === 'installing') return {
    title: 'Installing update',
    message: 'Papertrail will restart when the installer is ready.',
    action: null,
    progress: null
  };
  if (status.state === 'error') return {
    title: status.phase === 'install' ? 'Update installation failed' : 'Update failed',
    message: status.message || 'Open diagnostics for the service logs.',
    action: status.retryable ? 'Retry' : 'View logs',
    progress: null
  };
  return null;
}
