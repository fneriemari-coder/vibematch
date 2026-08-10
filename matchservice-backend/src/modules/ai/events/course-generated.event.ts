export const COURSE_GENERATED_EVENT = 'course.generated';

export interface CourseGeneratedEvent {
  courseId: string;
  skillsTaught: string[];
}
