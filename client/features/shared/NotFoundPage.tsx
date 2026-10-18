import { Link } from 'react-router';
import { EmptyState } from '@/components/ui';
import { IconCompass } from '@/components/icons';

export function NotFoundPage() {
  return (
    <div className="page page-narrow">
      <EmptyState icon={<IconCompass />} title="That page doesn’t exist" action={<Link to="/" className="btn btn-primary">Go home</Link>}>
        Let’s get you back somewhere familiar.
      </EmptyState>
    </div>
  );
}
