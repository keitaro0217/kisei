type Props = {
  status: 'connected' | 'connecting' | 'disconnected';
};

const config = {
  connected: { label: '連携済み', className: 'bg-green-100 text-green-700' },
  connecting: { label: '連携中...', className: 'bg-yellow-100 text-yellow-700' },
  disconnected: { label: '未連携', className: 'bg-gray-100 text-gray-500' },
};

export default function StatusBadge({ status }: Props) {
  const { label, className } = config[status];
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${className}`}>
      {status === 'connected' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 mr-1 align-middle" />}
      {label}
    </span>
  );
}
