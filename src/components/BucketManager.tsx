'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Tables } from '@/lib/database.types';

// Type for buckets received and managed by this component
// Include description now
type BucketManaged = Pick<Tables<'buckets'>, 'id' | 'name' | 'description'>;

interface BucketManagerProps {
  initialBuckets: BucketManaged[];
  userId: string;
}

// State for which bucket (if any) is being edited
type EditingState = string | null; // Stores the ID of the bucket being edited, or null

// --- BucketForm Component (Inline) ---
interface BucketFormProps {
    initialData: { name: string; description: string };
    isSaving: boolean;
    error: string | null;
    onSubmit: (formData: { name: string; description: string }) => Promise<void>;
    onCancel: () => void;
    mode: 'create' | 'edit';
}

function BucketForm({ initialData, isSaving, error, onSubmit, onCancel, mode }: BucketFormProps) {
    const [formData, setFormData] = useState(initialData);

    // Update local form state when initialData changes (e.g., when switching edits)
    useEffect(() => {
        setFormData(initialData);
    }, [initialData]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault(); // Prevent default form submission
        onSubmit(formData);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4 pt-4 border-t mt-2">
             <div>
                 <Label htmlFor={`bucketName-${mode}`}>{mode === 'create' ? 'New' : 'Edit'} Bucket Name</Label>
                 <Input 
                     id={`bucketName-${mode}`}
                     name="name"
                     value={formData.name}
                     onChange={handleInputChange}
                     placeholder="Bucket Name (e.g., Newsletters)"
                     disabled={isSaving}
                     required 
                 />
             </div>
             <div>
                 <Label htmlFor={`bucketDescription-${mode}`}>Description (Optional)</Label>
                 <Textarea
                     id={`bucketDescription-${mode}`}
                     name="description"
                     value={formData.description}
                     onChange={handleInputChange}
                     placeholder="Briefly describe the types of emails for this bucket."
                     rows={3}
                     disabled={isSaving}
                 />
             </div>
            <div className="flex justify-end space-x-2 pt-2">
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSaving || !formData.name.trim()}>
                    {isSaving ? 'Saving...' : 'Save Bucket'}
                </Button>
            </div>
            {error && <p className="text-red-500 text-sm pt-2">{error}</p>}
        </form>
    );
}

// --- BucketManager Component ---
export function BucketManager({ initialBuckets, userId }: BucketManagerProps) {
  const router = useRouter();
  const [buckets, setBuckets] = useState<BucketManaged[]>(initialBuckets);
  const [editingBucketId, setEditingBucketId] = useState<EditingState>(null);
  const [isCreating, setIsCreating] = useState(false); // Separate state for create form
  const [isLoading, setIsLoading] = useState(false); // Loading state shared by forms
  const [error, setError] = useState<string | null>(null); // Error state shared by forms

  // Derived state: Is any form currently open?
  const isFormOpen = isCreating || editingBucketId !== null;

  // Handler to open the create form
  const handleCreateClick = () => {
      setError(null);
      setIsCreating(true);
      setEditingBucketId(null); // Ensure no edit form is open
  };

  // Handler to open the edit form for a specific bucket
  const handleEditClick = (bucketId: string) => {
      setError(null);
      setEditingBucketId(bucketId);
      setIsCreating(false); // Ensure create form is closed
  };

  // Handler for submitting the create/edit form (unified logic)
  const handleFormSubmit = async (formData: { name: string; description: string }) => {
      setError(null);
      // Basic validation
      if (!formData.name.trim()) {
          setError("Bucket name cannot be empty.");
          return;
      }

      setIsLoading(true);
      const supabase = createClient();
      const dataToUpsert = {
           name: formData.name.trim(),
           description: formData.description.trim() || null,
           user_id: userId
      };

      const currentBucketId = editingBucketId; // Capture ID before state might change
      const creating = isCreating; // Capture mode before state might change

      try {
          if (creating) {
              // --- Create Bucket ---
              const { data: newBucket, error: insertError } = await supabase
                  .from('buckets')
                  .insert(dataToUpsert)
                  .select()
                  .single();

              if (insertError) throw insertError;
              if (newBucket) setBuckets(prev => [...prev, newBucket]);
              console.log("Bucket created:", newBucket);

          } else if (currentBucketId) {
              // --- Update Bucket ---
              const { data: updatedBucket, error: updateError } = await supabase
                  .from('buckets')
                  .update({ name: dataToUpsert.name, description: dataToUpsert.description })
                  .eq('id', currentBucketId)
                  .select()
                  .single();

              if (updateError) throw updateError;
              if (updatedBucket) setBuckets(prev => prev.map(b => b.id === updatedBucket.id ? updatedBucket : b));
              console.log("Bucket updated:", updatedBucket);
          }
          
          handleCancelForm(); // Close form on success
          router.refresh();

      } catch (err) {
          console.error("Error saving bucket:", err);
          const message = err instanceof Error ? err.message : 'An unknown error occurred';
          setError(`Failed to save bucket: ${message}`);
          // Keep form open on error
      } finally {
          setIsLoading(false);
      }
  };

  // Handler to close whichever form is open
  const handleCancelForm = () => {
      setEditingBucketId(null);
      setIsCreating(false);
      setError(null);
  };

  return (
    <div className="w-full space-y-4">
      <h2 className="text-xl font-semibold">Manage Buckets</h2>
      
      {/* Bucket Cards */}
      <div className="space-y-4"> 
        {buckets.map((bucket) => (
          <Card key={bucket.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{bucket.name}</CardTitle>
              {/* Only show Edit button if NO form is open */}
              {!isFormOpen && (
                  <Button variant="ghost" size="sm" onClick={() => handleEditClick(bucket.id)}>
                    Edit
                  </Button>
              )}
            </CardHeader>
            <CardContent>
                <p className="text-xs text-muted-foreground pb-2">
                    {bucket.description || <i>No description</i>}
                </p>
                 {/* Inline Edit Form - Render ONLY if this bucket is being edited */} 
                 {editingBucketId === bucket.id && (
                    <BucketForm
                        initialData={{
                            name: bucket.name, // bucket is guaranteed non-null here
                            description: bucket.description || '' 
                        }}
                        isSaving={isLoading}
                        error={error}
                        onSubmit={handleFormSubmit}
                        onCancel={handleCancelForm}
                        mode='edit'
                    />
                 )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create Button - only shown when no form is open */}
      {!isFormOpen && (
          <div className="mt-4">
              <Button onClick={handleCreateClick}>Create New Bucket</Button>
          </div>
      )}

       {/* Create Form - Render ONLY if isCreating is true */}
       {isCreating && (
           <Card className="mt-4">
               <CardHeader>
                   <CardTitle className="text-lg">Create New Bucket</CardTitle>
               </CardHeader>
               <CardContent className="space-y-4">
                    <BucketForm
                        initialData={{ name: '', description: '' }} // Start with empty data
                        isSaving={isLoading}
                        error={error}
                        onSubmit={handleFormSubmit}
                        onCancel={handleCancelForm}
                        mode='create'
                    />
               </CardContent>
           </Card>
       )}

      {/* Display general errors only when no form is open (form displays its own errors) */}
      {error && !isFormOpen && (
          <p className="text-red-500 text-sm mt-2">{error}</p>
      )}
    </div>
  );
} 