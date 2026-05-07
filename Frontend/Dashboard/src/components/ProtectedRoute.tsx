// Frontend/Dashboard/src/components/ProtectedRoute.tsx
import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import LoadingSpinner from './LoadingSpinner';

interface ProtectedRouteProps {
    children: ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
    const { user, loading } = useAuth() as any;

    const location = useLocation();

    if (loading) {
        return <LoadingSpinner />;
    }


    if (!user) {
        return <Navigate to="/loginIn.html" state={{ from: location }} replace />;
    }

    return <>{children}</>;
};