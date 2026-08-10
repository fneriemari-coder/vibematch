import '../../core/api/dio_client.dart';
import '../models/academy_models.dart';

class AcademyRepository {
  AcademyRepository(this._client);

  final DioClient _client;

  Future<CourseDetail> getCourseDetail(String courseId) async {
    final response = await _client.dio.get('/academy/courses/$courseId');
    return CourseDetail.fromJson(response.data as Map<String, dynamic>);
  }

  Future<CourseConnections> getCourseConnections(String courseId) async {
    final response = await _client.dio.get('/academy/course-connections/$courseId');
    return CourseConnections.fromJson(response.data as Map<String, dynamic>);
  }

  Future<String?> buyCourse(String courseId) async {
    final response = await _client.dio.post('/academy/buy-course', data: {'courseId': courseId});
    return (response.data as Map<String, dynamic>)['checkoutUrl'] as String?;
  }
}
