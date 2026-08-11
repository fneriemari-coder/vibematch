import '../../core/api/dio_client.dart';
import '../models/academy_models.dart';

class AcademyRepository {
  AcademyRepository(this._client);

  final DioClient _client;

  /// Catalogue grid. `search` is dropped when blank rather than sent empty,
  /// which the backend would read as "match the empty string".
  Future<CoursePage> listCourses({
    String? search,
    int limit = 20,
    int offset = 0,
  }) async {
    final response = await _client.dio.get(
      '/academy/courses',
      queryParameters: {
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        'limit': limit,
        'offset': offset,
      },
    );
    return CoursePage.fromJson(response.data as Map<String, dynamic>);
  }

  Future<MentorPage> listMentors({
    String? search,
    int limit = 20,
    int offset = 0,
  }) async {
    final response = await _client.dio.get(
      '/academy/mentors',
      queryParameters: {
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        'limit': limit,
        'offset': offset,
      },
    );
    return MentorPage.fromJson(response.data as Map<String, dynamic>);
  }

  Future<CourseDetail> getCourseDetail(String courseId) async {
    final response = await _client.dio.get('/academy/courses/$courseId');
    return CourseDetail.fromJson(response.data as Map<String, dynamic>);
  }

  Future<CourseConnections> getCourseConnections(String courseId) async {
    final response = await _client.dio.get(
      '/academy/course-connections/$courseId',
    );
    return CourseConnections.fromJson(response.data as Map<String, dynamic>);
  }

  /// Asks the AI factory to write a whole course (scope, module scripts,
  /// material pack) for the signed-in user. Returns the created course id.
  ///
  /// This can take a while server-side, so callers should show real progress
  /// rather than a spinner that looks stuck.
  Future<String> generateAiCourse({String? topicHint}) async {
    final response = await _client.dio.post(
      '/academy/generate-ai-course',
      data: {
        if (topicHint != null && topicHint.isNotEmpty) 'topicHint': topicHint
      },
    );
    // The factory answers `{ course, modules }`, not a bare course object.
    final data = response.data as Map<String, dynamic>;
    return (data['course'] as Map<String, dynamic>)['id'] as String;
  }

  Future<String?> buyCourse(String courseId) async {
    final response = await _client.dio.post(
      '/academy/buy-course',
      data: {'courseId': courseId},
    );
    return (response.data as Map<String, dynamic>)['checkoutUrl'] as String?;
  }
}
