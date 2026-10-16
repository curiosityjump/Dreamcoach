import { Link } from 'react-router';
import { EmptyState, Button } from '@/components/ui';
import { IconCompass } from '@/components/icons';

export function NotFoundPage() {
  return (
    <div className="page page-narrow">
      <EmptyState icon={<IconCompass />} title="That page doesn’t exist" action={<Link to="/"><Button variant="primary">Go home</Button></Link>}>
        Let’s get you back somewhere familiar.
      </EmptyState>
    </div>
  );
}
